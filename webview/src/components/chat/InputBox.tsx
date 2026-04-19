import { useCallback, useRef, useState } from 'react';

interface InputBoxProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isRunning?: boolean;
  placeholder?: string;
}

export function InputBox({ onSend, onStop, disabled, isRunning, placeholder }: InputBoxProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) { return; }
    onSend(trimmed);
    setValue('');
    inputRef.current?.focus();
  }, [value, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <div className="cb-input">
      <textarea
        ref={inputRef}
        className="cb-input__textarea"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Type a message…'}
        disabled={disabled}
        rows={1}
      />
      {isRunning ? (
        <button className="cb-input__stop" onClick={onStop} title="Stop">■</button>
      ) : (
        <button className="cb-input__send" onClick={handleSubmit} disabled={disabled || !value.trim()} title="Send">
          ↑
        </button>
      )}
    </div>
  );
}
