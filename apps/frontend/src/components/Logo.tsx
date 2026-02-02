import type { FC, SVGProps } from "react";

export const Logo: FC<SVGProps<SVGSVGElement>> = ({
  className,
  style,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 240 240"
    width="240"
    height="240"
    className={className ? `helpmaton-logo ${className}` : "helpmaton-logo"}
    style={{ overflow: "visible", ...style }}
    {...props}
  >
    <defs>
      <radialGradient id="reactorGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <stop offset="0%" style={{ stopColor: "#ffffff", stopOpacity: 1 }} />
        <stop offset="30%" style={{ stopColor: "#00ffff", stopOpacity: 0.9 }} />
        <stop offset="80%" style={{ stopColor: "#0055ff", stopOpacity: 0.4 }} />
        <stop offset="100%" style={{ stopColor: "#0000ff", stopOpacity: 0 }} />
      </radialGradient>

      <radialGradient id="panicGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <stop offset="0%" style={{ stopColor: "#ffff00", stopOpacity: 1 }} />
        <stop offset="30%" style={{ stopColor: "#ff0055", stopOpacity: 0.9 }} />
        <stop offset="80%" style={{ stopColor: "#ff0000", stopOpacity: 0.6 }} />
        <stop offset="100%" style={{ stopColor: "#990000", stopOpacity: 0 }} />
      </radialGradient>

      <filter id="neonBloom" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
        <feComponentTransfer in="blur" result="brightBlur">
          <feFuncR type="linear" slope="1.5" />
          <feFuncG type="linear" slope="1.5" />
          <feFuncB type="linear" slope="2" />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode in="brightBlur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <style>
        {`
          @keyframes jitter {
            0% { transform: translate(120px, 120px) rotate(0deg) scale(1); }
            25% { transform: translate(118px, 122px) rotate(-5deg) scale(0.9); }
            50% { transform: translate(122px, 118px) rotate(5deg) scale(0.95); }
            75% { transform: translate(119px, 121px) rotate(-3deg) scale(0.9); }
            100% { transform: translate(120px, 120px) rotate(0deg) scale(1); }
          }
          .helpmaton-logo:hover .main-shaker {
            animation: jitter 0.15s infinite linear !important;
            cursor: help;
          }
          .helpmaton-logo:hover .stator-ring { stroke: #ff0055 !important; transition: stroke 0.2s; }
          .helpmaton-logo:hover .ring-1 { stroke: #ffff00 !important; transition: stroke 0.2s; }
          .helpmaton-logo:hover .ring-2 { stroke: #ff4400 !important; transition: stroke 0.2s; }
          .helpmaton-logo:hover .ring-3 { stroke: #ff0099 !important; transition: stroke 0.2s; }
          .helpmaton-logo:hover .ring-4 { stroke: #ffaa00 !important; transition: stroke 0.2s; }
          .helpmaton-logo:hover .particle { fill: #ffff00 !important; transition: fill 0.2s; }
          .helpmaton-logo:hover .core-fill { fill: url(#panicGlow) !important; transition: fill 0.2s; }
          .helpmaton-logo:hover .core-inner { fill: #ffff00 !important; transition: fill 0.2s; }
        `}
      </style>
    </defs>

    <circle cx="120" cy="120" r="120" fill="#050a19" />

    <g className="main-shaker" transform="translate(120 120)">
      <g>
        <circle
          className="core-inner"
          cx="0"
          cy="0"
          r="15"
          fill="#ffffff"
          filter="url(#neonBloom)"
        >
          <animate attributeName="r" values="15;18;15" dur="0.8s" repeatCount="indefinite" />
        </circle>

        <circle
          className="core-fill"
          cx="0"
          cy="0"
          r="28"
          fill="url(#reactorGlow)"
          opacity="0.8"
        >
          <animate
            attributeName="r"
            values="28;32;28"
            dur="2s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.4 0 0.2 1; 0.4 0 0.2 1"
          />
        </circle>

        <path
          className="stator-ring"
          d="M0,-36 A36,36 0 0,1 36,0 M0,36 A36,36 0 0,1 -36,0"
          fill="none"
          stroke="#00ffff"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.9"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 0 0"
            to="360 0 0"
            dur="5s"
            repeatCount="indefinite"
          />
        </path>
        <path
          className="stator-ring"
          d="M36,0 A36,36 0 0,1 0,36 M-36,0 A36,36 0 0,1 0,-36"
          fill="none"
          stroke="#0055ff"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.9"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="360 0 0"
            to="0 0 0"
            dur="5s"
            repeatCount="indefinite"
          />
        </path>
      </g>

      <g filter="url(#neonBloom)">
        <circle
          className="ring-1"
          cx="0"
          cy="0"
          r="50"
          fill="none"
          stroke="#00ffff"
          strokeWidth="1.5"
          strokeDasharray="5 10"
          opacity="0.6"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="360 0 0"
            to="0 0 0"
            dur="8s"
            repeatCount="indefinite"
          />
        </circle>
        <g>
          <circle className="particle" cx="0" cy="-50" r="3" fill="#ffffff">
            <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
          </circle>
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="360 0 0"
            to="0 0 0"
            dur="8s"
            repeatCount="indefinite"
          />
        </g>
      </g>

      <g opacity="0.7">
        <path
          className="ring-2"
          d="M0,-70 L40,-55 L65,0 L40,55 L0,70 L-40,55 L-65,0 L-40,-55 Z"
          fill="none"
          stroke="#0055ff"
          strokeWidth="1"
          strokeDasharray="20 5"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 0 0"
            to="360 0 0"
            dur="15s"
            repeatCount="indefinite"
          />
        </path>
      </g>

      <g filter="url(#neonBloom)">
        <circle
          className="ring-3"
          cx="0"
          cy="0"
          r="90"
          fill="none"
          stroke="#00ffff"
          strokeWidth="2"
          strokeDasharray="50 30 10 30"
          opacity="0.8"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="360 0 0"
            to="0 0 0"
            dur="12s"
            repeatCount="indefinite"
          />
        </circle>
        <g>
          <circle className="particle" cx="0" cy="-90" r="4" fill="#00ffff" />
          <circle className="particle" cx="0" cy="90" r="4" fill="#00ffff" />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="360 0 0"
            to="0 0 0"
            dur="12s"
            repeatCount="indefinite"
          />
        </g>
      </g>

      <g filter="url(#neonBloom)" opacity="0.5">
        <circle
          className="ring-4"
          cx="0"
          cy="0"
          r="110"
          fill="none"
          stroke="#0055ff"
          strokeWidth="4"
          strokeDasharray="80 120"
          strokeLinecap="round"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 0 0"
            to="360 0 0"
            dur="25s"
            repeatCount="indefinite"
          />
        </circle>
      </g>
    </g>
  </svg>
);
