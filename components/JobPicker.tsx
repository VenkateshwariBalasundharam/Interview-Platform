'use client';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';

interface JobOption {
  id: string;
  title: string;
}

/** Type to search the jobs, then pick one with the mouse or the arrow keys and Enter. `value` is the chosen job id ('' = none).
 * With `onCreateNew`, a typed title that is not an existing job can be used as a new job. */
export function JobPicker({ id, jobs, value, onChange, onCreateNew, creating = false }: { id: string; jobs: JobOption[]; value: string; onChange: (jobId: string) => void; onCreateNew?: (title: string) => void; creating?: boolean }) {
  const listId = useId();
  const selected = jobs.find((j) => j.id === value);
  const [text, setText] = useState(selected?.title ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q || (selected && q === selected.title.trim().toLowerCase())) return jobs; // nothing typed yet: show everything
    return jobs.filter((j) => j.title.toLowerCase().includes(q));
  }, [jobs, text, selected]);

  const typed = text.trim();
  const canCreate = Boolean(onCreateNew) && typed.length >= 3 && !jobs.some((j) => j.title.trim().toLowerCase() === typed.toLowerCase());

  function createNew() {
    onCreateNew?.(typed);
    setOpen(false);
  }

  function pick(job: JobOption) {
    setText(job.title);
    onChange(job.id);
    setOpen(false);
  }

  function onType(next: string) {
    setText(next);
    setOpen(true);
    setActive(0);
    // Typing changes the choice: nothing is selected until a job is picked (or the text is exactly one job's title).
    const exact = jobs.filter((j) => j.title.trim().toLowerCase() === next.trim().toLowerCase());
    onChange(exact.length === 1 ? exact[0].id : '');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === 'Enter' && open && canCreate) {
      e.preventDefault();
      createNew();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Type to search jobs…"
        value={text}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-card py-1 text-sm shadow-md">
          {matches.length === 0 && <li className="px-3 py-2 text-muted-foreground">{jobs.length === 0 && !typed ? 'No jobs yet. Type a job title to create one.' : `No job matches “${typed}”`}</li>}
          {matches.map((j, i) => (
            <li
              key={j.id}
              role="option"
              aria-selected={j.id === value}
              // mousedown (not click) so the pick happens before the input loses focus and closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                pick(j);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-muted' : ''} ${j.id === value ? 'font-medium' : ''}`}
            >
              {j.title}
            </li>
          ))}
          {canCreate && (
            <li
              role="option"
              aria-selected={creating}
              onMouseDown={(e) => {
                e.preventDefault();
                createNew();
              }}
              className="cursor-pointer border-t px-3 py-1.5 font-medium text-primary hover:bg-muted"
            >
              + Create new job “{typed}”
            </li>
          )}
        </ul>
      )}
      {creating && !open && <p className="absolute left-0 top-full mt-1 text-xs text-muted-foreground">New job. Fill in the details below.</p>}
      {!value && !creating && text.trim() !== '' && !open && <p className="absolute left-0 top-full mt-1 text-xs text-amber-800">Pick a job from the list.</p>}
    </div>
  );
}
