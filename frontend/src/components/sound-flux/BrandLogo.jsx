import { brandSvg } from './brand.js'
import { getFrame } from './motion.js'

const mark = getFrame({ reduced: true })

export default function BrandLogo() {
  return (
    <span className="brand-logo" aria-hidden="true">
      <svg className="brand-blob" viewBox="-138 -138 276 276" fill="none">
        <path d={mark.main} fill="var(--color-yellow)" fillOpacity="0.4" stroke="var(--color-orange-strong)" strokeWidth="6" />
        <path d={mark.outer.d} stroke="var(--color-orange)" strokeWidth="3" />
      </svg>
      <span className="brand-wordmark" dangerouslySetInnerHTML={{ __html: brandSvg }} />
    </span>
  )
}
