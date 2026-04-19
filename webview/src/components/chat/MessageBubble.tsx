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

/* Monochrome SVG icons for chat roles */
const BoardIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 2h4v4H2V2Zm0 6h4v4H2V8Zm6-6h4v4H8V2Zm0 6h4v4H8V8Zm-7-7v14h14V1H1Zm1 1h12v12H2V2Z"/>
  </svg>
);
const AssistantIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1.5l1.86 3.77 4.16.6-3.01 2.94.71 4.14L8 10.88l-3.72 1.96.71-4.14-3.01-2.94 4.16-.6L8 1.5Z"/>
  </svg>
);
const UserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM3 13c0-2.76 2.24-5 5-5s5 2.24 5 5H3Z"/>
  </svg>
);

const avatarFor = (role: ChatBlockMessage['role']) => {
  switch (role) {
    case 'board':     return <BoardIcon />;
    case 'assistant': return <AssistantIcon />;
    case 'user':      return <UserIcon />;
  }
};

export function MessageBubble({ message }: { message: ChatBlockMessage }) {
  const isRight = message.role === 'user' || message.role === 'board';
  const cls = `cb-bubble cb-bubble--${message.role}`;

  return (
    <div className={cls}>
      {!isRight && (
        <div className="cb-bubble__avatar">{avatarFor(message.role)}</div>
      )}
      <div className="cb-bubble__content">
        {message.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
      </div>
      {isRight && (
        <div className="cb-bubble__avatar">{avatarFor(message.role)}</div>
      )}
    </div>
  );
}
