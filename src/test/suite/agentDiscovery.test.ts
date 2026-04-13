import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    AGENTS_DIR,
    AgentInfo,
    discoverAgents,
    readAgentInstructions,
    titleCase,
} from '../../genai-provider/agentDiscovery';

suite('agentDiscovery — titleCase', () => {
  test('converts hyphenated slug', () => {
    assert.strictEqual(titleCase('code-reviewer'), 'Code Reviewer');
  });

  test('converts underscored slug', () => {
    assert.strictEqual(titleCase('code_reviewer'), 'Code Reviewer');
  });

  test('single word', () => {
    assert.strictEqual(titleCase('reviewer'), 'Reviewer');
  });

  test('already capitalised', () => {
    assert.strictEqual(titleCase('Code-Reviewer'), 'Code Reviewer');
  });

  test('empty string', () => {
    assert.strictEqual(titleCase(''), '');
  });
});

suite('agentDiscovery — discoverAgents', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns empty when .github/agents does not exist', () => {
    const result = discoverAgents(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  test('returns empty when .github/agents has no .md files', () => {
    const dir = path.join(tmpDir, AGENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'not an agent');
    const result = discoverAgents(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  test('discovers a single agent with # heading', () => {
    const dir = path.join(tmpDir, AGENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'code-reviewer.md'), '# Code Reviewer Agent\n\nInstructions here.');
    const result = discoverAgents(tmpDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].slug, 'code-reviewer');
    assert.strictEqual(result[0].displayName, 'Code Reviewer Agent');
    assert.ok(result[0].filePath.endsWith('code-reviewer.md'));
    assert.strictEqual(result[0].canSquad, false);
  });

  test('parses canSquad from frontmatter', () => {
    const dir = path.join(tmpDir, AGENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'squad-agent.md'), '---\ncanSquad: true\n---\n# Squad Agent\n\nInstructions.');
    const result = discoverAgents(tmpDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].canSquad, true);
    assert.strictEqual(result[0].displayName, 'Squad Agent');
  });

  test('falls back to title-cased slug when no heading', () => {
    const dir = path.join(tmpDir, AGENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'my-agent.md'), 'No heading here.');
    const result = discoverAgents(tmpDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].displayName, 'My Agent');
  });

  test('discovers multiple agents', () => {
    const dir = path.join(tmpDir, AGENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'alpha.md'), '# Alpha');
    fs.writeFileSync(path.join(dir, 'beta.md'), '# Beta Bot');
    fs.writeFileSync(path.join(dir, 'not-an-agent.txt'), 'ignored');
    const result = discoverAgents(tmpDir);
    assert.strictEqual(result.length, 2);
    const slugs = result.map(a => a.slug).sort();
    assert.deepStrictEqual(slugs, ['alpha', 'beta']);
  });

  test('AGENTS_DIR constant is .github/agents', () => {
    assert.strictEqual(AGENTS_DIR, '.github/agents');
  });
});

suite('agentDiscovery — readAgentInstructions', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('reads file content', () => {
    const filePath = path.join(tmpDir, 'agent.md');
    fs.writeFileSync(filePath, '# Agent\n\nDo things.');
    const content = readAgentInstructions(filePath);
    assert.strictEqual(content, '# Agent\n\nDo things.');
  });

  test('returns undefined for missing file', () => {
    const content = readAgentInstructions(path.join(tmpDir, 'missing.md'));
    assert.strictEqual(content, undefined);
  });
});

suite('agentDiscovery — AgentInfo shape', () => {
  test('AgentInfo has correct fields', () => {
    const info: AgentInfo = {
      slug: 'test-agent',
      displayName: 'Test Agent',
      filePath: '/tmp/test-agent.md',
      canSquad: false,
    };
    assert.strictEqual(info.slug, 'test-agent');
    assert.strictEqual(info.displayName, 'Test Agent');
    assert.strictEqual(info.filePath, '/tmp/test-agent.md');
    assert.strictEqual(info.canSquad, false);
  });
});

suite('Messages — agent selection types', () => {
  test('WebViewToHost openCopilot with agentSlug', () => {
    const msg = {
      type: 'openCopilot' as const,
      taskId: 'github:42',
      providerId: 'cloud',
      agentSlug: 'code-reviewer',
    };
    assert.strictEqual(msg.agentSlug, 'code-reviewer');
  });

  test('WebViewToHost openCopilot without agentSlug', () => {
    const msg: { type: 'openCopilot'; taskId: string; providerId: string; agentSlug?: string } = {
      type: 'openCopilot' as const,
      taskId: 'github:42',
      providerId: 'cloud',
    };
    assert.strictEqual(msg.agentSlug, undefined);
  });

  test('WebViewToHost startSquad with agentSlug', () => {
    const msg = {
      type: 'startSquad' as const,
      agentSlug: 'test-agent',
    };
    assert.strictEqual(msg.agentSlug, 'test-agent');
  });

  test('WebViewToHost toggleAutoSquad with agentSlug', () => {
    const msg = {
      type: 'toggleAutoSquad' as const,
      agentSlug: 'test-agent',
    };
    assert.strictEqual(msg.agentSlug, 'test-agent');
  });

  test('HostToWebView agentsAvailable shape', () => {
    const msg = {
      type: 'agentsAvailable' as const,
      agents: [
        { slug: 'code-reviewer', displayName: 'Code Reviewer' },
        { slug: 'tester', displayName: 'Test Agent' },
      ],
    };
    assert.strictEqual(msg.type, 'agentsAvailable');
    assert.strictEqual(msg.agents.length, 2);
    assert.strictEqual(msg.agents[0].slug, 'code-reviewer');
  });
});
