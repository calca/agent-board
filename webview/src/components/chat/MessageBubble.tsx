import { CodeBlock, CommandBlock, ResultBlock, StepBlock, TextBlock } from './blocks';
import type { ChatBlockMessage, UIBlock } from './chatTypes';

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
  const isBoard = message.role === 'board';
  const cls = `cb-bubble cb-bubble--${message.role}`;

  return (
    <div className={cls}>
      {!isUser && !isBoard && (
        <div className="cb-bubble__avatar">◆</div>
      )}
      <div className="cb-bubble__content">
        {message.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
      </div>
      {(isUser || isBoard) && (
        <div className="cb-bubble__avatar">
          {isBoard ? '▦' : '👤'}
        </div>
      )}
    </div>
  );
}
