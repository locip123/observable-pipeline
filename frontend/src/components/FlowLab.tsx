import { useId } from 'react'
import type { Step, Runtime } from '../types'

export function FoxScene({ stage = 0, progress = 0, active = false, mint = false }: {
  stage?: number; progress?: number; active?: boolean; mint?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const color = stage >= 3 && !mint ? '#b59afc' : '#6adcb7'
  return <svg className={`fox-scene ${active ? 'is-active' : ''}`} viewBox="0 0 440 238" role="img" aria-label={`原创小狐狸动画素材，第 ${stage + 1} 阶段`}>
    <defs>
      <pattern id={`${id}-grid`} width="18" height="18" patternUnits="userSpaceOnUse">
        <path d="M18 0H0V18" fill="none" stroke="#657d91" strokeOpacity=".13" />
      </pattern>
      <pattern id={`${id}-alpha`} width="20" height="20" patternUnits="userSpaceOnUse">
        <rect width="20" height="20" fill="#152432"/><path d="M0 0H10V10H0ZM10 10H20V20H10Z" fill="#20303e"/>
      </pattern>
      <clipPath id={`${id}-wipe`}><rect width={440 * progress} height="238" /></clipPath>
    </defs>
    <rect width="440" height="238" rx="14" fill={stage === 2 ? `url(#${id}-alpha)` : '#132333'} />
    <rect width="440" height="238" fill={`url(#${id}-grid)`} />
    {stage < 2 && <g opacity=".7"><circle cx="330" cy="57" r="27" fill="#dae6ba"/>
      <path d="M0 175L80 90L160 175L275 76L440 200V238H0Z" fill="#29485b"/>
      <path d="M0 210L110 150L170 210L330 129L440 205V238H0Z" fill="#1b3b4a"/>
    </g>}
    <g className="orbit-ring"><ellipse cx="220" cy="132" rx="125" ry="60" fill="none" stroke="#5eaa98" strokeOpacity=".35" strokeDasharray="3 7"/>
      <circle cx="345" cy="132" r="4" fill="#80e6c4"/></g>
    {(stage === 1 || stage === 4 ? [-114, 0, 114] : [0]).map((offset, index) => <g key={offset} transform={`translate(${220 + offset},123) scale(${stage === 1 || stage === 4 ? .57 : .9})`}>
      <ellipse cy="85" rx="64" ry="10" fill="#030b17" opacity=".3"/>
      <g className="fox-body" style={{ animationDelay: `${index * -0.3}s` }}>
        <path d="M-39 41C-111 38-94-30-62-18C-72 5-37-4-25 22Z" fill={color}/>
        <path d="M-77-14Q-63-9-62 2L-74 10Z" fill="#f6edda"/>
        <path d="M-40-26L-46-77L-12-54Q13-63 35-49L64-70L54-13Q72 51 6 67Q-61 59-40-26Z" fill={color}/>
        <path d="M-36-62L-31-37L-18-48ZM53-55L38-44L50-30Z" fill="#477e83"/>
        <path d="M-31-6Q-11-20 4 1Q20-23 39-5L17 34L-10 34Z" fill="#fff2d9"/>
        <path d="M0 6L10 6L5 13Z" fill="#162f40"/>
        <path d="M-23-16L-14-16M25-16L34-16" stroke="#162f40" strokeWidth="5" strokeLinecap="round"/>
        <path d="M-18 51L-22 72M30 51L35 72" stroke={color} strokeWidth="16" strokeLinecap="round"/>
      </g>
    </g>)}
    {active && <g clipPath={`url(#${id}-wipe)`}><rect width="440" height="238" fill="#72e7bc" opacity=".045"/><path d={`M${440 * progress} 0V238`} stroke="#8ff5ce" strokeWidth="2" /></g>}
    <g fill="#8bb5bd"><path d="M62 51v12m-6-6h12M367 176v12m-6-6h12" stroke="currentColor"/><circle cx="109" cy="39" r="2"/><circle cx="382" cy="80" r="2"/></g>
    <text x="16" y="221" fill="#8da7b9" fontFamily="monospace" fontSize="10">FOX / ORBIT · SVG {stage === 5 ? 'ANIMATED OUTPUT' : 'SOURCE MATERIAL'}</text>
  </svg>
}

export function FlowLab({ step, runtime, mint }: { step: Step; runtime?: Runtime; mint: boolean }) {
  const active = step.status === 'running' && runtime?.phase === 'computing'
  const artifact = step.artifacts.at(-1)
  const progress = runtime?.progress ?? step.progress
  return <section className="flow-lab panel">
    <div className="section-heading"><div><span className="eyebrow">ASSET TRANSFORMATION</span><h3>素材正在怎样变化</h3></div><span className="tag">SVG 手绘素材 · MOCK 计算</span></div>
    <div className="asset-flow">
      <div className="asset-frame"><span className="mini-label">01 / INPUT · {step.order === 0 ? '原始素材' : '前序步骤产物'}</span><FoxScene stage={Math.max(0, step.order - 1)} mint={mint}/></div>
      <div className={`transform-gate ${active ? 'is-active' : ''}`}><span className="gate-icon">✧</span><strong>{step.display_name}</strong><span>{Math.round(progress * 100)}%</span><div className="packet-track"><i/><i/><i/></div></div>
      <div className="asset-frame"><span className="mini-label">02 / OUTPUT · {artifact ? '已持久化 SVG' : '处理过程示意'}</span>
        {artifact ? <a href={`/api/artifacts/${artifact.id}`} target="_blank" rel="noreferrer" title="打开实际 SVG 产物"><img className="artifact-preview" src={`/api/artifacts/${artifact.id}`} alt={`${step.display_name}的实际产物`}/></a> : <FoxScene stage={step.order} progress={progress} active={active} mint={mint}/>}</div>
    </div>
    <div className="flow-footnote"><span className="live-dot"/>进度来自 Worker 上报；成功后切换为产物卷中的真实 SVG 文件。</div>
  </section>
}
