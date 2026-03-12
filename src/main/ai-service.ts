import {
  AssistantMatch,
  CaptureBatchResult,
  AssistantQueryResult,
  CaptureDraft,
  CaptureDraftResult,
  CaptureExtraction,
  Category,
  ExtractedCustomField,
  PlainRecord,
} from './contracts';
import { VaultService } from './vault-service';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const STOP_WORDS = [
  '密码',
  '是什么',
  '多少',
  '告诉我',
  '请问',
  '查询',
  '搜索',
  '账号',
  'key',
  '密钥',
  'secret',
  '是什么啊',
];

const SEARCH_ALIAS_GROUPS = [
  ['google', ['google', '谷歌', 'gmail']],
  ['gmail', ['gmail', 'google', '谷歌']],
  ['github', ['github', 'git']],
  ['gitee', ['gitee', '码云', 'git']],
  ['gitlab', ['gitlab', 'git']],
  ['microsoft', ['microsoft', '微软', 'outlook', 'hotmail', 'live']],
  ['outlook', ['outlook', 'microsoft', '微软', 'hotmail', 'live']],
  ['apple', ['apple', '苹果', 'icloud']],
  ['icloud', ['icloud', 'apple', '苹果']],
  ['openai', ['openai', 'chatgpt', 'gpt']],
  ['chatgpt', ['chatgpt', 'openai', 'gpt']],
] as const satisfies ReadonlyArray<readonly [string, readonly string[]]>;

const SEARCH_ALIAS_MAP = SEARCH_ALIAS_GROUPS.reduce<Record<string, string[]>>((map, [, aliases]) => {
  for (const alias of aliases) {
    const normalized = alias.toLowerCase();
    map[normalized] = [...new Set([...(map[normalized] ?? []), ...aliases.map((item) => item.toLowerCase())])];
  }
  return map;
}, {});

const FIELD_ALIASES = {
  address: ['地址', '网址', 'url', 'site', '网站'],
  account: ['账号', '账户', '用户名', '邮箱', 'email', 'user', 'login'],
  password: ['密码', 'pass', 'password', 'pwd'],
  key: ['key', 'api key', 'apikey', 'token', 'secret'],
} as const;

type CaptureFieldKind = keyof typeof FIELD_ALIASES | 'custom' | 'heading' | 'note';

interface ClassifiedLine {
  kind: CaptureFieldKind;
  line: string;
}

interface AssistantMetadataCandidate {
  recordId: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  addressHost?: string;
  customFieldNames: string[];
  hasAccount: boolean;
  hasPassword: boolean;
  hasKey: boolean;
  favorite: boolean;
}

const MAX_MODEL_RETRIEVAL_CANDIDATES = 200;

export class AIService {
  constructor(private readonly vault: VaultService) {}

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const config = this.getUsableConfig();
    const payload = await this.chatJson<{ status: string }>(
      [
        'You are a service health check.',
        'Return strict JSON only.',
      ].join(' '),
      'Respond with {"status":"ok"}.',
      config,
    );

    if (payload.status !== 'ok') {
      return { success: false, error: 'Model returned an unexpected response' };
    }

    return { success: true };
  }

  async captureDraft(rawText: string): Promise<CaptureBatchResult> {
    const categories = this.vault.getCategories();
    const drafts = buildCaptureDrafts(rawText, categories);
    const warnings: string[] = [];

    if (drafts.length > 1) {
      warnings.push(`已识别出 ${drafts.length} 条候选记录，可逐条检查后批量创建。`);
    }

    if (this.hasUsableModel()) {
      for (const result of drafts) {
        try {
          const enhanced = await this.enhanceCaptureDraft(result.rawText, result.extraction, categories);
          result.draft.name = enhanced.name || result.draft.name;
          result.draft.categoryId = enhanced.categoryId || result.draft.categoryId;
          result.draft.reasoning = enhanced.reasoning || result.draft.reasoning;
          if (enhanced.customFields?.length) {
            result.draft.customFields = enhanced.customFields.map((field, index) => ({
              fieldName: field.fieldName || result.draft.customFields[index]?.fieldName || `字段${index + 1}`,
              fieldValue: result.draft.customFields[index]?.fieldValue,
            }));
          }
          result.usedModel = true;
        } catch (error) {
          result.warnings.push(`模型整理失败，已回退到本地提取：${toErrorMessage(error)}`);
        }
      }
    }

    return {
      rawText,
      drafts,
      warnings,
    };
  }

  async query(question: string): Promise<AssistantQueryResult> {
    const localMatches = this.findLocalMatches(question);
    const intent = detectQuestionIntent(question);
    const countIntent = detectCountIntent(question);
    let matches = localMatches;
    let usedModel = false;

    if (this.hasUsableModel() && this.getSearchMode() === 'extended') {
      try {
        const semanticMatches = await this.findModelMatches(question, localMatches);
        if (semanticMatches.length > 0) {
          matches = semanticMatches;
          usedModel = true;
        }
      } catch {
        // Fall back to local-only retrieval when semantic search is unavailable.
      }
    }

    const fallbackAnswer = buildLocalAssistantAnswer(question, matches);

    if (matches.length <= 1 || intent !== 'generic' || countIntent) {
      return {
        answer: fallbackAnswer,
        results: matches,
        usedModel,
      };
    }

    if (!this.hasUsableModel()) {
      return {
        answer: fallbackAnswer,
        results: matches,
        usedModel: false,
      };
    }

    try {
      const config = this.getUsableConfig();
      const payload = await this.chatJson<{ answer: string }>(
        [
          'You are a password-vault assistant.',
          'Only use the candidate list provided by the user.',
          'Never invent records and never reveal secrets.',
          'If you echo any account, address, username, email, or other field value, preserve it exactly as provided.',
          'Do not add punctuation, quotes, brackets, or any extra characters immediately before or after a field value.',
          'Return strict JSON only with one field: answer.',
        ].join(' '),
        JSON.stringify({
          question,
          candidates: matches.map((match) => ({
            name: match.name,
            categoryId: match.categoryId,
            categoryName: match.categoryName,
            addressHost: safeHost(match.address),
            accountMasked: maskAccount(match.account),
            hasPassword: match.hasPassword,
            hasKey: match.hasKey,
            matchedFields: match.matchedFields,
          })),
        }),
        config,
      );

      return {
        answer: payload.answer || fallbackAnswer,
        results: matches,
        usedModel: true,
      };
    } catch {
      return {
        answer: fallbackAnswer,
        results: matches,
        usedModel: false,
      };
    }
  }

  findLocalMatches(question: string): AssistantMatch[] {
    const records = this.vault.getAllRecords();
    const tokens = tokenizeQuery(question);
    const categories = this.vault.getCategories();

    const scored = records
      .map((record) => {
        const matchedFields = new Set<string>();
        const haystacks: Array<[string, string[]]> = [
          ['name', buildSearchVariants(record.name)],
          ['address', buildSearchVariants(record.address)],
          ['account', buildSearchVariants(record.account)],
        ];

        for (const field of record.customFields) {
          haystacks.push([`field:${field.fieldName}`, buildSearchVariants(field.fieldName)]);
          haystacks.push([`fieldValue:${field.fieldName}`, buildSearchVariants(field.fieldValue)]);
        }

        let score = 0;
        for (const token of tokens) {
          for (const [fieldName, values] of haystacks) {
            if (values.some((value) => value.includes(token))) {
              score += fieldName === 'name' ? 5 : 3;
              matchedFields.add(fieldName);
            }
          }
        }

        if (!score && question.trim() && record.name.toLowerCase().includes(question.trim().toLowerCase())) {
          score = 4;
          matchedFields.add('name');
        }

        return { record, score, matchedFields };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.record.name.localeCompare(right.record.name))
      .slice(0, 8);

    return scored.map(({ record, matchedFields }) => this.toAssistantMatch(record, categories, [...matchedFields]));
  }

  private async enhanceCaptureDraft(
    rawText: string,
    extraction: CaptureExtraction,
    categories: Category[],
  ): Promise<Partial<CaptureDraft>> {
    const config = this.getUsableConfig();
    const payload = await this.chatJson<{
      name?: string;
      categoryId?: string;
      reasoning?: string;
      customFields?: Array<{ fieldName?: string }>;
    }>(
      [
        'You help structure password-vault entries.',
        'Secrets are intentionally redacted before they reach you.',
        'Choose one categoryId from the supplied list and return strict JSON only.',
      ].join(' '),
      JSON.stringify({
        rawPreview: buildRedactedPreview(rawText).slice(0, 240),
        categories: categories.map((category) => ({
          id: category.id,
          name: category.name,
        })),
        extraction: {
          addressHost: safeHost(extraction.address),
          accountMasked: maskAccount(extraction.account),
          hasPassword: Boolean(extraction.password),
          hasKey: Boolean(extraction.key),
          customFields: extraction.customFields.map((field) => ({
            fieldName: field.fieldName,
            fieldValueMasked: field.fieldValue ? '[REDACTED]' : '',
          })),
          notes: extraction.notes.slice(0, 5),
        },
      }),
      config,
    );

    return {
      name: payload.name,
      categoryId: payload.categoryId,
      reasoning: payload.reasoning,
      customFields: payload.customFields
        ?.filter((field) => Boolean(field.fieldName))
        .map((field) => ({ fieldName: field.fieldName! })),
    };
  }

  private hasUsableModel(): boolean {
    const config = this.vault.getAISettings();
    return Boolean(config.baseUrl && config.model && config.apiKey);
  }

  private getSearchMode(): 'local' | 'extended' {
    return this.vault.getAISettings().searchMode === 'local' ? 'local' : 'extended';
  }

  private getUsableConfig() {
    const config = this.vault.getAISettings();
    if (!config.baseUrl || !config.model || !config.apiKey) {
      throw new Error('AI settings are incomplete');
    }
    return config;
  }

  private async findModelMatches(question: string, localMatches: AssistantMatch[]): Promise<AssistantMatch[]> {
    const config = this.getUsableConfig();
    const categories = this.vault.getCategories();
    const records = this.vault.getAllRecords();
    const metadataCandidates = this.buildMetadataCandidates(records, categories, localMatches);
    if (metadataCandidates.length === 0) {
      return localMatches;
    }

    const payload = await this.chatJson<{ recordIds?: string[] }>(
      [
        'You are a retrieval planner for a password vault.',
        'Use only the sanitized metadata records provided by the user.',
        'Never invent records and never reveal or infer secrets.',
        'Select the most relevant recordIds for the question using semantic understanding, brand aliases, category hints, URL hosts, and custom field names.',
        'Prefer broad recall for count and list questions.',
        'Return strict JSON only with one field: recordIds.',
      ].join(' '),
      JSON.stringify({
        question,
        candidates: metadataCandidates,
      }),
      config,
    );

    const chosenIds = Array.isArray(payload.recordIds)
      ? [...new Set(payload.recordIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
      : [];

    if (chosenIds.length === 0) {
      return localMatches;
    }

    const recordMap = new Map(records.map((record) => [record.id, record]));
    const localMap = new Map(localMatches.map((match) => [match.recordId, match]));
    const results = chosenIds
      .map((recordId) => {
        const record = recordMap.get(recordId);
        if (!record) {
          return null;
        }

        const localMatch = localMap.get(recordId);
        const matchedFields = localMatch
          ? [...new Set([...localMatch.matchedFields, 'AI语义检索'])]
          : ['AI语义检索'];

        return this.toAssistantMatch(record, categories, matchedFields);
      })
      .filter((match): match is AssistantMatch => Boolean(match))
      .slice(0, 8);

    return results.length > 0 ? results : localMatches;
  }

  private buildMetadataCandidates(
    records: PlainRecord[],
    categories: Category[],
    localMatches: AssistantMatch[],
  ): AssistantMetadataCandidate[] {
    const localMatchIds = new Set(localMatches.map((match) => match.recordId));
    const prioritized = records
      .slice()
      .sort((left, right) => {
        const leftBoost = localMatchIds.has(left.id) ? 1 : 0;
        const rightBoost = localMatchIds.has(right.id) ? 1 : 0;
        if (leftBoost !== rightBoost) {
          return rightBoost - leftBoost;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      })
      .slice(0, MAX_MODEL_RETRIEVAL_CANDIDATES);

    return prioritized.map((record) => ({
      recordId: record.id,
      name: record.name,
      categoryId: record.categoryId,
      categoryName: categories.find((category) => category.id === record.categoryId)?.name,
      addressHost: safeHost(record.address),
      customFieldNames: record.customFields
        .map((field) => field.fieldName.trim())
        .filter(Boolean),
      hasAccount: Boolean(record.account),
      hasPassword: Boolean(record.password),
      hasKey: Boolean(record.key),
      favorite: record.favorite,
    }));
  }

  private toAssistantMatch(record: PlainRecord, categories: Category[], matchedFields: string[]): AssistantMatch {
    return {
      recordId: record.id,
      name: record.name,
      address: record.address,
      account: record.account,
      categoryId: record.categoryId,
      categoryName: categories.find((category) => category.id === record.categoryId)?.name,
      hasPassword: Boolean(record.password),
      hasKey: Boolean(record.key),
      matchedFields,
    };
  }

  private async chatJson<T>(systemPrompt: string, userPrompt: string, config: { baseUrl: string; model: string; apiKey?: string }): Promise<T> {
    const baseUrl = config.baseUrl.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Model returned an empty response');
    }

    return JSON.parse(stripMarkdownFences(content)) as T;
  }
}

export function extractFromText(rawText: string): CaptureExtraction {
  const lines = normalizeLines(rawText);

  const address = extractLabeledValue(lines, FIELD_ALIASES.address) ?? extractUrl(lines);
  const account = extractLabeledValue(lines, FIELD_ALIASES.account) ?? lines.find(looksLikeEmail);
  const password = extractLabeledValue(lines, FIELD_ALIASES.password);
  const key = extractLabeledValue(lines, FIELD_ALIASES.key) ?? lines.find(looksLikeApiKey);

  const customFields: ExtractedCustomField[] = [];
  const notes: string[] = [];

  for (const line of lines) {
    const labeled = getLabeledField(line);
    if (labeled && resolveFieldKind(labeled.key)) {
      continue;
    }
    if (looksLikeEmail(line) || looksLikePlainAddress(line) || looksLikeApiKey(line)) {
      continue;
    }

    if (labeled) {
      customFields.push({
        fieldName: labeled.key,
        fieldValue: labeled.value,
      });
      continue;
    }

    if (line.length > 4) {
      notes.push(line);
    }
  }

  return {
    address: address ?? undefined,
    account: account ?? undefined,
    password: password ?? undefined,
    key: key ?? undefined,
    customFields,
    notes,
  };
}

export function buildCaptureDrafts(rawText: string, categories: Category[]): CaptureDraftResult[] {
  const segments = splitRawTextIntoEntries(rawText);
  const sources = segments.length ? segments : [rawText];
  return sources.map((segment) => buildCaptureDraftResult(segment, categories));
}

export function splitRawTextIntoEntries(rawText: string): string[] {
  const lines = rawText.split(/\r?\n/);
  const segments: string[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];
  const currentFields = new Set<CaptureFieldKind>();

  const flush = () => {
    if (currentLines.length === 0) {
      return;
    }

    const mergedLines = currentHeading && currentLines[0] !== currentHeading
      ? [currentHeading, ...currentLines]
      : [...currentLines];
    const mergedText = mergedLines.join('\n');
    const extraction = extractFromText(mergedText);
    if (hasUsefulCaptureData(extraction)) {
      segments.push(mergedText);
    }

    currentLines = [];
    currentFields.clear();
  };

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) {
      if (currentLines.length && hasPrimaryField(currentFields)) {
        flush();
      }
      continue;
    }

    const classified = classifyLine(line);
    if (classified.kind === 'heading') {
      if (currentLines.length) {
        flush();
      }
      currentHeading = classified.line;
      continue;
    }

    if (shouldStartNewEntry(classified, currentFields)) {
      flush();
    }

    currentLines.push(classified.line);
    currentFields.add(classified.kind);
  }

  flush();
  return segments;
}

function extractLabeledValue(lines: string[], keys: readonly string[]): string | undefined {
  for (const line of lines) {
    const labeled = getLabeledField(line);
    if (labeled && keys.includes(labeled.key.toLowerCase())) {
      return labeled.value;
    }
  }
  return undefined;
}

function buildCaptureDraftResult(rawText: string, categories: Category[]): CaptureDraftResult {
  const extraction = extractFromText(rawText);
  const draft: CaptureDraft = {
    name: guessRecordName(rawText, extraction),
    categoryId: inferCategoryId(rawText, categories),
    address: extraction.address,
    account: extraction.account,
    password: extraction.password,
    key: extraction.key,
    customFields: [...extraction.customFields],
  };
  const warnings: string[] = [];

  if (!extraction.password && !extraction.key) {
    warnings.push('未识别出明确的密码或 Key，请确认原文中是否包含敏感字段。');
  }
  if (!draft.account && !draft.address && extraction.customFields.length === 0) {
    warnings.push('未识别出明确的账号或地址，请检查原文格式。');
  }
  if (!draft.name) {
    warnings.push('未识别出明确名称，已使用默认名称，请在保存前确认。');
    draft.name = '未命名记录';
  }

  return {
    rawText,
    extraction,
    draft,
    usedModel: false,
    warnings,
  };
}

function normalizeLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
}

function normalizeLine(line: string): string {
  return line
    .replace(/\r/g, '')
    .trim()
    .replace(/^[•·●◦▪■◆▶►▸▹\-–—*]+\s*/, '')
    .replace(/^\d+\s*[.)、]\s*/, '')
    .trim();
}

function classifyLine(line: string): ClassifiedLine {
  if (getLabeledField(line)) {
    const labeled = getLabeledField(line)!;
    return { kind: resolveFieldKind(labeled.key) ?? 'custom', line };
  }

  if (looksLikeEmail(line)) {
    return { kind: 'account', line };
  }

  if (looksLikePlainAddress(line)) {
    return { kind: 'address', line };
  }

  if (isLikelyHeading(line)) {
    return { kind: 'heading', line };
  }

  return { kind: 'note', line };
}

function getLabeledField(line: string): { key: string; value: string } | null {
  const match = line.match(/^([^:：]{1,30})\s*[:：]\s*(.+)$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    key: match[1].trim(),
    value: match[2].trim(),
  };
}

function resolveFieldKind(key: string): keyof typeof FIELD_ALIASES | undefined {
  const normalized = key.trim().toLowerCase();
  for (const [kind, aliases] of Object.entries(FIELD_ALIASES) as Array<[keyof typeof FIELD_ALIASES, readonly string[]]>) {
    if (aliases.includes(normalized)) {
      return kind;
    }
  }
  return undefined;
}

function shouldStartNewEntry(classified: ClassifiedLine, currentFields: Set<CaptureFieldKind>): boolean {
  if (currentFields.size === 0) {
    return false;
  }

  if (classified.kind === 'account') {
    return currentFields.has('account') || currentFields.has('password') || currentFields.has('key');
  }

  if (classified.kind === 'password' || classified.kind === 'key' || classified.kind === 'address') {
    return currentFields.has(classified.kind);
  }

  return false;
}

function hasPrimaryField(fields: Set<CaptureFieldKind>): boolean {
  return ['address', 'account', 'password', 'key', 'custom'].some((kind) => fields.has(kind as CaptureFieldKind));
}

function hasUsefulCaptureData(extraction: CaptureExtraction): boolean {
  return Boolean(
    extraction.address ||
    extraction.account ||
    extraction.password ||
    extraction.key ||
    extraction.customFields.length ||
    extraction.notes.length,
  );
}

function extractUrl(lines: string[]): string | undefined {
  for (const line of lines) {
    const httpMatch = line.match(/https?:\/\/[^\s]+/i);
    if (httpMatch?.[0]) {
      return httpMatch[0];
    }
  }

  for (const line of lines) {
    if (line.includes('@')) {
      continue;
    }
    if (looksLikePlainAddress(line)) {
      return line;
    }
  }
  return undefined;
}

function guessRecordName(rawText: string, extraction: CaptureExtraction): string {
  const lines = normalizeLines(rawText);
  const title = lines.find(isLikelyHeading);
  if (title) {
    return title;
  }

  const host = safeHost(extraction.address);
  if (host) {
    return host.replace(/^www\./, '');
  }

  if (extraction.account) {
    return extraction.account.split('@')[0];
  }

  return '未命名记录';
}

function inferCategoryId(rawText: string, categories: Category[]): string {
  const lower = rawText.toLowerCase();
  const heuristics: Array<[string[], string]> = [
    [['openai', 'claude', 'gemini', 'cursor', 'api'], 'ai-tools'],
    [['steam', 'epic', 'unity', 'unreal', 'game'], 'game-dev'],
    [['公司', '企业', '工作', 'jira', '飞书', 'slack', 'github'], 'work'],
    [['淘宝', '京东', '生活', '家庭'], 'life'],
  ];

  for (const [keywords, categoryId] of heuristics) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return categoryId;
    }
  }

  return categories[0]?.id ?? 'daily';
}

function looksLikeEmail(line: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(line);
}

function looksLikePlainAddress(line: string): boolean {
  if (looksLikeEmail(line)) {
    return false;
  }
  return /^(?:https?:\/\/[^\s]+|(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?)$/i.test(line);
}

function looksLikeApiKey(line: string): boolean {
  return /^(sk-[a-z0-9_\-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|AIza[0-9A-Za-z\-_]{20,}|[A-Za-z0-9_\-]{24,})$/i.test(line);
}

function isLikelyHeading(line: string): boolean {
  if (!line || getLabeledField(line) || looksLikeEmail(line) || looksLikePlainAddress(line)) {
    return false;
  }

  return line.length <= 60 && /[\p{L}\p{N}]/u.test(line);
}

function buildRedactedPreview(rawText: string): string {
  return normalizeLines(rawText)
    .map((line) => {
      const labeled = getLabeledField(line);
      if (labeled) {
        return `${labeled.key}: [REDACTED]`;
      }
      if (looksLikeEmail(line) || looksLikeApiKey(line)) {
        return '[REDACTED]';
      }
      return line;
    })
    .join('\n');
}

export function tokenizeQuery(question: string): string[] {
  const normalized = normalizeQuestion(question);
  const asciiTokens = normalized.match(/[a-z0-9._-]+/g) ?? [];
  const cjkTokens = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];

  const tokens = [...new Set([...asciiTokens, ...cjkTokens])]
    .flatMap((token) => expandSearchAliases(token))
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.includes(token))
    .filter((token) => token.length > 1);

  if (tokens.length > 0) {
    return [...new Set(tokens)];
  }

  const fallback = question.toLowerCase().match(/[a-z0-9._-]+/g) ?? [question.trim()];
  return fallback.filter(Boolean);
}

export function buildLocalAssistantAnswer(question: string, matches: AssistantMatch[]): string {
  const target = describeQuestionTarget(question);

  if (matches.length === 0) {
    return `没有找到和“${target}”相关的记录。`;
  }

  const intent = detectQuestionIntent(question);
  if (detectCountIntent(question)) {
    const relatedCount = countMatchesByIntent(matches, intent);
    if (intent === 'account') {
      return `找到 ${matches.length} 条与“${target}”相关的记录，其中 ${relatedCount} 条保存了账号信息。`;
    }
    if (intent === 'address') {
      return `找到 ${matches.length} 条与“${target}”相关的记录，其中 ${relatedCount} 条保存了地址信息。`;
    }
    if (intent === 'password') {
      return `找到 ${matches.length} 条与“${target}”相关的记录，其中 ${relatedCount} 条保存了密码。`;
    }
    if (intent === 'key') {
      return `找到 ${matches.length} 条与“${target}”相关的记录，其中 ${relatedCount} 条保存了 Key。`;
    }
    return `找到 ${matches.length} 条与“${target}”相关的记录。`;
  }

  if (matches.length === 1) {
    const record = matches[0];
    if (intent === 'account') {
      return record.account
        ? `${record.name} 的账号: ${record.account}`
        : `${record.name} 没有保存账号信息。`;
    }
    if (intent === 'address') {
      return record.address
        ? `${record.name} 的地址: ${record.address}`
        : `${record.name} 没有保存地址信息。`;
    }
    if (intent === 'password') {
      return `${record.name} 已找到。请在结果卡片中点击“显示密码”。`;
    }
    if (intent === 'key') {
      return `${record.name} 已找到。请在结果卡片中点击“显示 Key”。`;
    }

    const summary = [
      record.account ? `账号：${record.account}` : null,
      record.address ? `地址：${record.address}` : null,
    ].filter(Boolean).join('，');
    return summary
      ? `找到 1 条记录：${record.name}。${summary}`
      : `找到 1 条记录：${record.name}。`;
  }

  return `找到 ${matches.length} 条候选记录，请从结果列表中确认目标。`;
}

function detectQuestionIntent(question: string): 'account' | 'address' | 'password' | 'key' | 'generic' {
  const normalized = question.toLowerCase();
  if (/(账号|账户|用户名|邮箱|email|user|login)/i.test(normalized)) {
    return 'account';
  }
  if (/(地址|网址|url|site|网站|域名|链接)/i.test(normalized)) {
    return 'address';
  }
  if (/(密码|pass|password|pwd)/i.test(normalized)) {
    return 'password';
  }
  if (/(key|密钥|token|secret|apikey|api key)/i.test(normalized)) {
    return 'key';
  }
  return 'generic';
}

function detectCountIntent(question: string): boolean {
  return /(几个|几条|多少个|多少条|多少|几份)/i.test(question);
}

function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[？?！!，,。.；;：:"'“”‘’（）()]/g, ' ')
    .replace(/(请问|告诉我|查询|搜索|一下|帮我|看看|给我|我的|我|有几个|几个|有多少|多少个|多少条|多少|几条|有哪些|哪些|哪个|有没有|有吗|吗|呢|账号|账户|用户名|邮箱|地址|网址|网站|链接|密码|密钥|api key|apikey|token|secret|key|的|是|什么|一下子)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeQuestionTarget(question: string): string {
  const normalized = normalizeQuestion(question);
  const asciiTokens = normalized.match(/[a-z0-9._-]+/g) ?? [];
  const cjkTokens = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  const target = [...asciiTokens, ...cjkTokens].find(Boolean);
  return target || question.trim();
}

function countMatchesByIntent(
  matches: AssistantMatch[],
  intent: 'account' | 'address' | 'password' | 'key' | 'generic',
): number {
  if (intent === 'account') {
    return matches.filter((match) => Boolean(match.account)).length;
  }
  if (intent === 'address') {
    return matches.filter((match) => Boolean(match.address)).length;
  }
  if (intent === 'password') {
    return matches.filter((match) => match.hasPassword).length;
  }
  if (intent === 'key') {
    return matches.filter((match) => match.hasKey).length;
  }
  return matches.length;
}

function buildSearchVariants(value?: string): string[] {
  if (!value) {
    return [];
  }

  const variants = new Set<string>();
  const normalized = value.toLowerCase().trim();
  const add = (candidate?: string) => {
    const token = candidate?.trim().toLowerCase();
    if (!token || STOP_WORDS.includes(token) || token.length <= 1) {
      return;
    }
    variants.add(token);
  };

  add(normalized);

  for (const token of normalized.match(/[a-z0-9._-]+|[\p{Script=Han}]{2,}/gu) ?? []) {
    add(token);
    for (const alias of expandSearchAliases(token)) {
      add(alias);
    }
  }

  if (normalized.includes('@')) {
    const [localPart, domain] = normalized.split('@');
    add(localPart);
    add(domain);
    for (const segment of domain.split(/[._-]+/)) {
      add(segment);
      for (const alias of expandSearchAliases(segment)) {
        add(alias);
      }
    }
  }

  const host = safeHost(value).toLowerCase();
  add(host);
  for (const segment of host.split(/[._-]+/)) {
    add(segment);
    for (const alias of expandSearchAliases(segment)) {
      add(alias);
    }
  }

  return [...variants];
}

function expandSearchAliases(token: string): string[] {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const variants = new Set<string>([normalized]);
  const aliases = SEARCH_ALIAS_MAP[normalized] ?? [];
  for (const alias of aliases) {
    variants.add(alias);
  }

  if (normalized.includes('@')) {
    const [, domain = ''] = normalized.split('@');
    variants.add(domain);
  }

  for (const part of normalized.split(/[._-]+/)) {
    if (!part) {
      continue;
    }
    variants.add(part);
    const partAliases = SEARCH_ALIAS_MAP[part] ?? [];
    for (const alias of partAliases) {
      variants.add(alias);
    }
  }

  return [...variants];
}

function safeHost(address?: string): string {
  if (!address) {
    return '';
  }
  try {
    const url = address.startsWith('http') ? new URL(address) : new URL(`https://${address}`);
    return url.hostname;
  } catch {
    return address.split('/')[0];
  }
}

function maskAccount(account?: string): string {
  if (!account) {
    return '';
  }
  if (account.includes('@')) {
    const [name, domain] = account.split('@');
    return `${name.slice(0, 1)}***@${domain}`;
  }
  return `${account.slice(0, 2)}***`;
}

function stripMarkdownFences(content: string): string {
  return content.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
