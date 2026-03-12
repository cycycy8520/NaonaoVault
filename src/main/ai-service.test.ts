import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCaptureDrafts, buildLocalAssistantAnswer, extractFromText, tokenizeQuery } from './ai-service';
import { AIService } from './ai-service';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('extractFromText', () => {
  it('extracts the common vault fields from messy text', () => {
    const extraction = extractFromText(`
OpenAI 平台
网址: https://platform.openai.com
账号: demo@example.com
密码: SuperSecret!123
组织: org-demo
项目: alpha
`);

    expect(extraction.address).toBe('https://platform.openai.com');
    expect(extraction.account).toBe('demo@example.com');
    expect(extraction.password).toBe('SuperSecret!123');
    expect(extraction.customFields).toEqual([
      { fieldName: '组织', fieldValue: 'org-demo' },
      { fieldName: '项目', fieldValue: 'alpha' },
    ]);
  });

  it('ignores bullet prefixes and does not treat email domains as addresses', () => {
    const extraction = extractFromText(`
GitHub
• 账号：cy8520cy@163.com
• 密码：cy8520ads
`);

    expect(extraction.address).toBeUndefined();
    expect(extraction.account).toBe('cy8520cy@163.com');
    expect(extraction.password).toBe('cy8520ads');
  });
});

describe('buildCaptureDrafts', () => {
  it('splits repeated account and password lines into multiple drafts', () => {
    const drafts = buildCaptureDrafts(
      `
GitHub
• 账号：cy8520cy@163.com
• 密码：cy8520ads
• 510516968@qq.com
• 密码：cy8520ads
`,
      [
        { id: 'work', name: '工作', icon: '💼', color: '#000000', sortOrder: 0 },
      ],
    );

    expect(drafts).toHaveLength(2);
    expect(drafts[0].draft.name).toBe('GitHub');
    expect(drafts[0].draft.account).toBe('cy8520cy@163.com');
    expect(drafts[0].draft.password).toBe('cy8520ads');
    expect(drafts[1].draft.name).toBe('GitHub');
    expect(drafts[1].draft.account).toBe('510516968@qq.com');
    expect(drafts[1].draft.password).toBe('cy8520ads');
  });
});

describe('assistant query helpers', () => {
  it('extracts stable latin search tokens from natural-language questions', () => {
    expect(tokenizeQuery('gitee的账号是什么')).toContain('gitee');
    expect(tokenizeQuery('GITee')).toContain('gitee');
  });

  it('keeps the target service name from Chinese natural-language questions and expands aliases', () => {
    const tokens = tokenizeQuery('我的谷歌账号有几个');

    expect(tokens).toContain('谷歌');
    expect(tokens).toContain('google');
    expect(tokens).not.toContain('账号');
  });

  it('answers account questions directly when a single local record matches', () => {
    const answer = buildLocalAssistantAnswer('gitee的账号是什么', [
      {
        recordId: 'gitee-1',
        name: 'Gitee',
        address: 'https://gitee.com',
        account: 'someone@example.com',
        categoryId: 'work',
        categoryName: '工作',
        hasPassword: true,
        hasKey: false,
        matchedFields: ['name'],
      },
    ]);

    expect(answer).toBe('Gitee 的账号: someone@example.com');
  });

  it('answers count questions for account records directly', () => {
    const answer = buildLocalAssistantAnswer('我的谷歌账号有几个', [
      {
        recordId: 'google-1',
        name: 'Google Workspace',
        address: 'https://accounts.google.com',
        account: 'first@gmail.com',
        categoryId: 'work',
        categoryName: '工作',
        hasPassword: true,
        hasKey: false,
        matchedFields: ['name'],
      },
      {
        recordId: 'google-2',
        name: 'Google Ads',
        address: 'https://ads.google.com',
        account: 'second@gmail.com',
        categoryId: 'work',
        categoryName: '工作',
        hasPassword: true,
        hasKey: false,
        matchedFields: ['name'],
      },
    ]);

    expect(answer).toBe('找到 2 条与“谷歌”相关的记录，其中 2 条保存了账号信息。');
  });

  it('matches Google records when the user asks with 谷歌', () => {
    const service = new AIService({
      getAllRecords: () => [
        {
          id: 'google-1',
          name: 'Google Workspace',
          categoryId: 'work',
          address: 'https://accounts.google.com',
          account: 'workspace@gmail.com',
          password: 'secret-1',
          key: undefined,
          icon: undefined,
          color: undefined,
          favorite: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: undefined,
          updatedByDeviceId: 'device-1',
          customFields: [],
        },
        {
          id: 'github-1',
          name: 'GitHub',
          categoryId: 'work',
          address: 'https://github.com',
          account: 'octocat@example.com',
          password: 'secret-2',
          key: undefined,
          icon: undefined,
          color: undefined,
          favorite: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: undefined,
          updatedByDeviceId: 'device-1',
          customFields: [],
        },
      ],
      getCategories: () => [
        { id: 'work', name: '工作', icon: '💼', color: '#0EA5E9', sortOrder: 0 },
      ],
      getAISettings: () => ({ baseUrl: '', model: '', apiKey: '' }),
    } as any);

    const matches = service.findLocalMatches('我的谷歌账号有几个');

    expect(matches).toHaveLength(1);
    expect(matches[0]?.recordId).toBe('google-1');
  });

  it('uses model-side metadata retrieval when extended search is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ recordIds: ['google-1'] }),
            },
          },
        ],
      }),
    }));

    const service = new AIService({
      getAllRecords: () => [
        {
          id: 'google-1',
          name: 'Google Workspace',
          categoryId: 'work',
          address: 'https://accounts.google.com',
          account: 'workspace@gmail.com',
          password: 'secret-1',
          key: undefined,
          icon: undefined,
          color: undefined,
          favorite: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: undefined,
          updatedByDeviceId: 'device-1',
          customFields: [],
        },
      ],
      getCategories: () => [
        { id: 'work', name: '工作', icon: '💼', color: '#0EA5E9', sortOrder: 0 },
      ],
      getAISettings: () => ({
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-test',
        apiKey: 'sk-demo',
        searchMode: 'extended',
      }),
    } as any);

    const result = await service.query('邮箱套件账号有几个');

    expect(result.usedModel).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.recordId).toBe('google-1');
    expect(result.answer).toBe('找到 1 条与“套件”相关的记录，其中 1 条保存了账号信息。');
  });
});
