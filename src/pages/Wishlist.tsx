import { Images, Sparkles, ThumbsUp } from 'lucide-react'
import { PageHeader } from '@/components/AppShell'

const COMING = [
  {
    icon: Images,
    color: '#F45D1E',
    title: 'Share inspiration',
    body: 'Drop in links and photos of things you’d love for the flat.',
  },
  {
    icon: ThumbsUp,
    color: '#8585F5',
    title: 'Vote on favourites',
    body: 'Everyone gets a few votes, so the best ideas rise to the top.',
  },
  {
    icon: Sparkles,
    color: '#1FAE7A',
    title: 'Decide together',
    body: 'Turn a winning idea into a checklist item in one tap.',
  },
]

/** Phase 2 placeholder: intentional, honest, and consistent with the rest of the app. */
export function WishlistPage() {
  return (
    <>
      <PageHeader title="Wishlist" hideTitleUntilScroll />
      <div className="px-4 lg:px-0">
        <div className="pt-2 pb-8">
          <h1 className="text-[38px] leading-[1.04] tracking-[-0.035em]">
            <span className="font-light">Dream it up,</span>
            <br />
            <span className="font-extrabold">together</span>
          </h1>
          <p className="text-ink-2 mt-3 max-w-md text-[17px]">
            The shared wishlist is the next thing we’re building. It’s where the fun extras live — the things you want, not just the
            things you need.
          </p>
        </div>

        <ul className="flex max-w-xl flex-col gap-6">
          {COMING.map(({ icon: Icon, color, title, body }) => (
            <li key={title} className="flex gap-4">
              <Icon size={28} strokeWidth={2} style={{ color }} className="mt-0.5 shrink-0" aria-hidden />
              <div>
                <h2 className="text-[18px] font-bold">{title}</h2>
                <p className="text-ink-2 mt-0.5">{body}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="bg-surface-2 mt-10 max-w-xl rounded-[var(--radius-card)] p-5 text-[15px]">
          <span className="font-bold">Coming soon.</span>{' '}
          <span className="text-ink-2">The 20 ideas already on your Google Sheet’s Wishlist tab will come across when it launches.</span>
        </p>
      </div>
    </>
  )
}
