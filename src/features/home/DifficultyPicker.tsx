import { DIFFICULTIES, type Difficulty } from "@/contracts/difficulty";

type Props = {
  difficulty: Difficulty;
  activeDifficulty?: Difficulty;
  disabled: boolean;
  onChange: (difficulty: Difficulty) => void;
};

export function DifficultyPicker({
  difficulty,
  activeDifficulty,
  disabled,
  onChange,
}: Props) {
  return (
    <fieldset
      className="difficulty-picker"
      disabled={disabled}
    >
      <legend>学习难度</legend>
      <div className="difficulty-options">
        {(Object.keys(DIFFICULTIES) as Difficulty[]).map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={difficulty === level}
            onClick={() => onChange(level)}
          >
            {DIFFICULTIES[level].label}
          </button>
        ))}
      </div>
      <span className="tiny-note">
        {DIFFICULTIES[difficulty].description}
        {activeDifficulty
          ? ` · 本次仍为${DIFFICULTIES[activeDifficulty].label}，调整从新主题生效`
          : " · 新主题使用此难度"}
      </span>
    </fieldset>
  );
}
