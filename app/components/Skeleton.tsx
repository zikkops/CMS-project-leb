import type { CSSProperties } from 'react'

export default function Skeleton({
  width = '100%',
  height = '1rem',
  borderRadius = '4px',
  style,
}: {
  width?: string | number
  height?: string | number
  borderRadius?: string
  style?: CSSProperties
}) {
  return (
    <div style={{
      position: 'relative',
      overflow: 'hidden',
      width,
      height,
      borderRadius,
      backgroundColor: 'rgba(255,255,255,0.04)',
      ...style,
    }}>
      <div style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: '-60%',
        width: '50%',
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
        transform: 'skewX(-20deg)',
        animation: 'skeletonShine 1.6s ease-in-out infinite',
      }} />
    </div>
  )
}
