import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type FlatButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon';

interface FlatButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: FlatButtonVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  fullWidth?: boolean;
}

export function FlatButton({
  variant = 'secondary',
  size = 'md',
  icon,
  fullWidth,
  className,
  children,
  ...rest
}: FlatButtonProps) {
  const cls = [
    'flat-btn',
    `flat-btn--${variant}`,
    size === 'sm' && 'flat-btn--sm',
    fullWidth && 'flat-btn--block',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={cls} {...rest}>
      {icon && <span className="flat-btn__icon">{icon}</span>}
      {children}
    </button>
  );
}
