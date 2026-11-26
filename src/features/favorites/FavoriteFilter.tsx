"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/Icon";

type FilterOption = {
  value: string;
  label: string;
};

/** 收藏筛选专用单选菜单；焦点留在触发器，支持键盘选择和点击外部关闭。 */
export function FavoriteFilter({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({
    text: "",
    time: 0,
  });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = Math.max(
    0,
    options.findIndex((item) => item.value === value),
  );
  const expanded = open && !disabled;
  const activeIndex = Math.min(active, options.length - 1);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!expanded) return;
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);

  useEffect(() => {
    if (expanded) {
      document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [expanded, activeIndex, id]);

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    setOpen(false);
    trigger.current?.focus();
    if (option.value !== value) onChange(option.value);
  }

  /** 浏览选项不立即发请求；回车或空格确认，Escape/Tab 保留原筛选。 */
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab" || event.key === "Escape") {
      setOpen(false);
      if (event.key === "Escape" && expanded) event.preventDefault();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (expanded) choose(activeIndex);
      else {
        setActive(selected);
        setOpen(true);
      }
      return;
    }
    const navigation = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (navigation.includes(event.key)) {
      event.preventDefault();
      let next = selected;
      if (expanded) next = activeIndex;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = options.length - 1;
      else if (expanded) next += event.key === "ArrowDown" ? 1 : -1;
      setActive(Math.max(0, Math.min(options.length - 1, next)));
      setOpen(true);
      return;
    }
    if (
      event.key.length !== 1 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    search.current = {
      text:
        (Date.now() - search.current.time < 700 ? search.current.text : "") +
        event.key,
      time: Date.now(),
    };
    const match = options.findIndex((item) =>
      item.label
        .toLocaleLowerCase()
        .startsWith(search.current.text.toLocaleLowerCase()),
    );
    if (match >= 0) {
      setActive(match);
      setOpen(true);
    }
  }

  return (
    <div className="favorite-filter">
      <span id={`${id}-label`}>{label}</span>
      <div
        className="favorite-select"
        ref={root}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setOpen(false);
        }}
      >
        <button
          ref={trigger}
          type="button"
          className="favorite-select-trigger"
          role="combobox"
          aria-labelledby={`${id}-label`}
          aria-haspopup="listbox"
          aria-expanded={expanded}
          aria-controls={expanded ? `${id}-list` : undefined}
          aria-activedescendant={
            expanded ? `${id}-option-${activeIndex}` : undefined
          }
          disabled={disabled}
          onKeyDown={handleKeyDown}
          onClick={() => {
            setActive(selected);
            setOpen(!expanded);
          }}
        >
          <span>{options[selected]?.label}</span>
          <Icon
            name="chevronDown"
            size={16}
          />
        </button>
        {expanded && (
          <ul
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className="favorite-select-menu"
          >
            {options.map((option, index) => (
              <li
                id={`${id}-option-${index}`}
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                data-active={index === activeIndex}
                onPointerMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {option.value === value && (
                  <Icon
                    name="check"
                    size={15}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
