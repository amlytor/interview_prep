// Circular progress ring showing a topic's 0-100 mastery score.
// Color communicates the band: red/amber below proficient (60), blue up to
// mastered (80), green at mastered and above.
interface MasteryRingProps {
  score: number; // 0-100
  size?: number; // px
  locked?: boolean;
}

function ringColor(score: number): string {
  if (score >= 80) return "var(--green-600)";
  if (score >= 60) return "var(--blue-500)";
  if (score >= 30) return "var(--amber-600)";
  return "var(--red-600)";
}

export function MasteryRing({ score, size = 56, locked = false }: MasteryRingProps) {
  const stroke = Math.max(4, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;

  return (
    <svg width={size} height={size} className="mastery-ring" role="img" aria-label={`Mastery ${score}%`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--gray-200)"
        strokeWidth={stroke}
      />
      {filled > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={locked ? "var(--gray-300)" : ringColor(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          // Start the arc at 12 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={size / 3.4}
        fontWeight={700}
        fontFamily="Georgia, serif"
        fill={locked ? "var(--gray-500)" : "var(--navy-900)"}
      >
        {locked ? "🔒" : score}
      </text>
    </svg>
  );
}
