import type { FC } from "react";

interface LockSpinnerProps {
  size: "small" | "medium" | "large";
  className?: string;
}

export const LockSpinner: FC<LockSpinnerProps> = ({ size, className = "" }) => {
  const containerSize = size === "small" ? 24 : size === "medium" ? 48 : 128;
  const center = containerSize / 2;
  
  // Arc configurations: [radius, strokeWidth, startAngle, endAngle]
  const arcs =
    size === "small"
      ? [
          // Small size: 3 arcs
          { radius: 10, strokeWidth: 2, startAngle: 0, endAngle: 270 },
          { radius: 7, strokeWidth: 1.5, startAngle: 45, endAngle: 315 },
          { radius: 4, strokeWidth: 1, startAngle: 90, endAngle: 360 },
        ]
      : size === "medium"
        ? [
            // Medium size: 3 arcs
            { radius: 20, strokeWidth: 2.5, startAngle: 0, endAngle: 270 },
            { radius: 14, strokeWidth: 2, startAngle: 45, endAngle: 315 },
            { radius: 8, strokeWidth: 1.5, startAngle: 90, endAngle: 360 },
          ]
        : [
            // Large size: 4 arcs for more detail
            { radius: 56, strokeWidth: 4, startAngle: 0, endAngle: 270 },
            { radius: 42, strokeWidth: 3, startAngle: 45, endAngle: 315 },
            { radius: 28, strokeWidth: 2.5, startAngle: 90, endAngle: 360 },
            { radius: 14, strokeWidth: 2, startAngle: 135, endAngle: 225 },
          ];

  // Convert angle to SVG coordinates
  const getArcPath = (
    radius: number,
    startAngle: number,
    endAngle: number
  ) => {
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = center + radius * Math.cos(startRad);
    const y1 = center + radius * Math.sin(startRad);
    const x2 = center + radius * Math.cos(endRad);
    const y2 = center + radius * Math.sin(endRad);
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`;
  };

  return (
    <div className={`relative ${className}`} style={{ width: containerSize, height: containerSize }}>
      <svg
        width={containerSize}
        height={containerSize}
        className="absolute inset-0"
      >
        {/* Outer arc - clockwise, normal speed */}
        <path
          d={getArcPath(arcs[0].radius, arcs[0].startAngle, arcs[0].endAngle)}
          fill="none"
          stroke="currentColor"
          strokeWidth={arcs[0].strokeWidth}
          className="text-primary-500"
          style={{
            animation: "lock-spin-cw 2s linear infinite",
            transformOrigin: `${center}px ${center}px`,
          }}
        />

        {/* Middle arc - counter-clockwise, faster speed */}
        <path
          d={getArcPath(arcs[1].radius, arcs[1].startAngle, arcs[1].endAngle)}
          fill="none"
          stroke="currentColor"
          strokeWidth={arcs[1].strokeWidth}
          className="text-primary-400"
          style={{
            animation: "lock-spin-ccw 1.5s linear infinite",
            transformOrigin: `${center}px ${center}px`,
          }}
        />

        {/* Inner arc - clockwise, slower speed */}
        <path
          d={getArcPath(arcs[2].radius, arcs[2].startAngle, arcs[2].endAngle)}
          fill="none"
          stroke="currentColor"
          strokeWidth={arcs[2].strokeWidth}
          className="text-primary-300"
          style={{
            animation: "lock-spin-cw 2.5s linear infinite",
            transformOrigin: `${center}px ${center}px`,
          }}
        />

        {/* Fourth arc (large size only) - counter-clockwise, medium speed */}
        {size === "large" && (
          <path
            d={getArcPath(arcs[3].radius, arcs[3].startAngle, arcs[3].endAngle)}
            fill="none"
            stroke="currentColor"
            strokeWidth={arcs[3].strokeWidth}
            className="text-primary-200"
            style={{
              animation: "lock-spin-ccw 1.8s linear infinite",
              transformOrigin: `${center}px ${center}px`,
            }}
          />
        )}
      </svg>

      <style>{`
        @keyframes lock-spin-cw {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes lock-spin-ccw {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(-360deg);
          }
        }
      `}</style>
    </div>
  );
};

