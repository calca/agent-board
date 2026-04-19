import type { UIBlock, ChatBlockMessage } from './chatTypes';
import { TextBlock, CodeBlock, CommandBlock, ResultBlock, StepBlock } from './blocks';

function BlockRenderer({ block }: { block: UIBlock }) {
  switch (block.type) {
    case 'text':    return <TextBlock content={block.content} streaming={block.streaming} />;
    case 'code':    return <CodeBlock content={block.content} language={block.language} />;
    case 'command': return <CommandBlock content={block.content} />;
    case 'result':  return <ResultBlock content={block.content} />;
    case 'step':    return <StepBlock label={block.label} status={block.status} />;
  }
}

export function MessageBubble({ message }: { message: ChatBlockMessage }) {
  const isUser = message.role === 'user';
  const cls = `cb-bubble cb-bubble--${message.role}`;

  return (
    <div className={cls}>
      <div className="cb-bubble__avatar">
        {isUser ? '👤' : '◆'}
      </div>
      <div className="cb-bubble__content">
        {message.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
      </div>
    </div>
  );
}
