/**
 * A wide illustration on desktop, a portrait one on phones, behind text.
 *
 * The art keeps a quiet side for copy — the references' wide images reserve
 * their left third, the portraits their bottom — and a CSS scrim sits over
 * it regardless, so text never depends on the picture staying dark. It is
 * decoration: the text beside it carries the meaning, so alt is empty.
 */
export default function HeroArt({ wide, portrait, className = '' }) {
  if (!wide) return null
  return (
    <picture className={`hero-art ${className}`}>
      {portrait && <source media="(max-width: 700px)" srcSet={portrait.srcset} sizes="100vw" />}
      <img
        src={wide.src}
        srcSet={wide.srcset}
        sizes="(max-width: 1320px) 100vw, 1250px"
        width={wide.width}
        height={wide.height}
        alt=""
        aria-hidden="true"
        decoding="async"
        draggable="false"
      />
    </picture>
  )
}
