import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const join = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  return (
    <button
      type="button"
      className={join(
        'inline-flex h-9 items-center justify-center rounded-md px-3.5 text-sm font-medium transition-colors disabled:opacity-50',
        variant === 'primary'
          ? 'bg-primary text-on-primary hover:bg-primary-hover'
          : 'border border-border bg-surface text-text hover:bg-canvas',
        className,
      )}
      {...props}
    />
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-3.5 text-sm font-semibold">{title}</h2>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Badge({ tone, children }: { tone: 'success' | 'danger'; children: ReactNode }) {
  return (
    <span
      className={join(
        'inline-flex rounded px-2 py-0.5 text-xs font-medium',
        tone === 'success' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger',
      )}
    >
      {children}
    </span>
  );
}

export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-border">
      {items.map((item) => (
        <div key={item.label} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-sm text-muted">{item.label}</dt>
          <dd className="text-right text-sm font-medium tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="inline-flex rounded-md border border-border bg-canvas p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={join(
            'cursor-pointer rounded px-3.5 py-1.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
            option.value === value ? 'bg-surface font-medium text-text shadow-sm' : 'text-muted hover:text-text',
          )}
        >
          <input
            type="radio"
            className="sr-only"
            name={label}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

const controlClass =
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-muted disabled:opacity-50';

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span role="alert" className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

export function Input({ className, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={join(controlClass, className)} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text" {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={join(controlClass, className)} {...props} />;
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
      <input type="checkbox" className="size-4 accent-primary" {...props} />
      {label}
    </label>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-danger-bg px-3.5 py-2.5 text-sm text-danger">
      {children}
    </p>
  );
}

/** Liste modifiable de libellés. */
export function TagList({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const add = (input: HTMLInputElement) => {
    const value = input.value.trim();
    if (!value) return;
    if (!items.some((item) => item.localeCompare(value, 'fr', { sensitivity: 'base' }) === 0)) onChange([...items, value]);
    input.value = '';
  };
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      {items.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item} className="inline-flex items-center gap-1 rounded border border-border bg-canvas py-0.5 pl-2 pr-1 text-sm">
              {item}
              <button
                type="button"
                aria-label={`Retirer ${item}`}
                className="rounded px-1 text-muted hover:text-danger"
                onClick={() => onChange(items.filter((other) => other !== item))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        aria-label={label}
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            add(event.currentTarget);
          }
        }}
        onBlur={(event) => add(event.currentTarget)}
      />
    </div>
  );
}

export function DataTable<T>({
  rows,
  rowKey,
  columns,
  empty,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  columns: { header: string; align?: 'right'; render: (row: T) => ReactNode }[];
  empty: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-muted">
          {columns.map((column) => (
            <th key={column.header} scope="col" className={join('px-3 py-2 font-medium first:pl-0 last:pr-0', column.align === 'right' && 'text-right')}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className="border-b border-border last:border-0">
            {columns.map((column) => (
              <td key={column.header} className={join('px-3 py-2.5 first:pl-0 last:pr-0', column.align === 'right' && 'text-right tabular-nums')}>
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
