import * as assert from 'assert';
import { OutputParser } from '../../stream/OutputParser';

suite('OutputParser', () => {
  test('plain text produces a text block', () => {
    const p = new OutputParser();
    p.feed('hello world');
    const blocks = p.flush();
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'text');
    assert.strictEqual((blocks[0] as { content: string }).content, 'hello world');
  });

  test('fenced code block produces a code block', () => {
    const p = new OutputParser();
    p.feed('```typescript\nconst x = 1;\n```');
    const blocks = p.flush();
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'code');
    const b = blocks[0] as { type: 'code'; language: string; content: string };
    assert.strictEqual(b.language, 'typescript');
    assert.strictEqual(b.content, 'const x = 1;');
  });

  test('diff block gets special type', () => {
    const p = new OutputParser();
    p.feed('```diff\n- old\n+ new\n```');
    const blocks = p.flush();
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'diff');
    assert.strictEqual((blocks[0] as { content: string }).content, '- old\n+ new');
  });

  test('bash block gets special type', () => {
    const p = new OutputParser();
    p.feed('```bash\nnpm install\n```');
    const blocks = p.flush();
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'bash');
    assert.strictEqual((blocks[0] as { content: string }).content, 'npm install');
  });

  test('sh and shell map to bash type', () => {
    for (const lang of ['sh', 'shell']) {
      const p = new OutputParser();
      p.feed(`\`\`\`${lang}\necho hi\n\`\`\``);
      const blocks = p.flush();
      assert.strictEqual(blocks[0].type, 'bash', `${lang} should map to bash`);
    }
  });

  test('FILE: line produces a file block', () => {
    const p = new OutputParser();
    p.feed('FILE: src/index.ts');
    const blocks = p.flush();
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'file');
    assert.strictEqual((blocks[0] as { type: 'file'; path: string }).path, 'src/index.ts');
  });

  test('mixed content produces multiple blocks', () => {
    const p = new OutputParser();
    p.feed('some text\n```diff\n- x\n```\nFILE: a.ts\nmore text');
    const blocks = p.flush();
    assert.strictEqual(blocks.length, 4);
    assert.strictEqual(blocks[0].type, 'text');
    assert.strictEqual(blocks[1].type, 'diff');
    assert.strictEqual(blocks[2].type, 'file');
    assert.strictEqual(blocks[3].type, 'text');
  });

  test('flush resets state for reuse', () => {
    const p = new OutputParser();
    p.feed('first');
    const b1 = p.flush();
    assert.strictEqual(b1.length, 1);
    p.feed('second');
    const b2 = p.flush();
    assert.strictEqual(b2.length, 1);
    assert.strictEqual((b2[0] as { content: string }).content, 'second');
  });

  test('unclosed fence is flushed as code block', () => {
    const p = new OutputParser();
    p.feed('```python\nprint("hi")');
    const blocks = p.flush();
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'code');
  });

  test('empty text lines are not emitted as blocks', () => {
    const p = new OutputParser();
    p.feed('');
    const blocks = p.flush();
    assert.strictEqual(blocks.length, 0);
  });

  test('fenced block without language defaults to text', () => {
    const p = new OutputParser();
    p.feed('```\nraw content\n```');
    const blocks = p.flush();
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'code');
    assert.strictEqual((blocks[0] as { type: 'code'; language: string }).language, 'text');
  });
});
