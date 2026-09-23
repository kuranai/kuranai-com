import { useEffect, useId, type KeyboardEventHandler } from 'react';

import type { SlashCommandDefinition } from './slashCommands';

export interface SlashCommandPaletteProps {
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onSelect: (command: SlashCommandDefinition) => void;
  options: SlashCommandDefinition[];
  position: { left: number; top: number };
  query: string;
}

export function SlashCommandPalette({
  activeIndex,
  onActiveIndexChange,
  onKeyDown,
  onSelect,
  options,
  position,
  query,
}: SlashCommandPaletteProps) {
  const titleId = useId();

  useEffect(() => {
    if (activeIndex < 0 || activeIndex >= options.length) {
      return;
    }

    document
      .getElementById(`slash-command-${options[activeIndex]?.id ?? ''}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, options]);

  return (
    <div
      aria-describedby={`${titleId}-hint`}
      aria-labelledby={titleId}
      className="slash-command-palette"
      onKeyDown={onKeyDown}
      role="dialog"
      style={{ left: position.left, top: position.top }}
    >
      <div className="slash-command-heading">
        <div>
          <span className="state-kicker">Insert</span>
          <h2 id={titleId}>Slash commands</h2>
        </div>
        <span className="slash-command-query" aria-label="Slash command filter">
          /{query}
        </span>
      </div>
      <p className="slash-command-hint" id={`${titleId}-hint`}>
        Type to filter, then use the arrow keys and Enter. Escape closes this menu.
      </p>
      <div aria-label="Slash command options" className="slash-command-options" role="listbox">
        {options.length === 0 ? (
          <p className="slash-command-empty">No commands match “{query}”.</p>
        ) : (
          options.map((command, index) => (
            <button
              aria-selected={index === activeIndex}
              className={
                index === activeIndex ? 'slash-command-option is-active' : 'slash-command-option'
              }
              id={`slash-command-${command.id}`}
              key={command.id}
              onClick={() => onSelect(command)}
              onFocus={() => onActiveIndexChange(index)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <span className="slash-command-option-main">
                <strong>{command.label}</strong>
                <small>{command.description}</small>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
