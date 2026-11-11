import { FileDown, Plus } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/AppShell'
import { useToast } from '@/components/Toast'
import { Button, EmptyState, ErrorPanel, IconButton, Segmented, Spinner } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import { IdeaCard } from '@/wishlist/IdeaCard'
import { IdeaSheet } from '@/wishlist/IdeaSheet'
import { sortIdeas, useWishlist, WishlistProvider, type Idea, type WishSort } from '@/wishlist/WishlistProvider'

export function WishlistPage() {
  return (
    <WishlistProvider>
      <WishlistScreen />
    </WishlistProvider>
  )
}

function WishlistScreen() {
  const { status, error, ideas, reload, importOriginal } = useWishlist()
  const { rooms } = useHousehold()
  const toast = useToast()
  const [sort, setSort] = useState<WishSort>('popular')
  const [open, setOpen] = useState<Idea | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])
  const list = useMemo(() => sortIdeas(ideas, sort), [ideas, sort])
  const chosen = ideas.filter((i) => i.is_chosen).length
  const hasOriginal = ideas.some((i) => i.import_key)

  const runImport = async () => {
    setImporting(true)
    const res = await importOriginal()
    setImporting(false)
    if (!res.ok) return toast.error(res.error)
    toast.success(res.data.created ? `Brought across ${res.data.created} ideas` : 'Already up to date')
  }

  return (
    <>
      <PageHeader
        title="Wishlist"
        hideTitleUntilScroll
        actions={
          <IconButton label="Add an idea" onClick={() => setAdding(true)}>
            <Plus size={24} aria-hidden />
          </IconButton>
        }
      />
      <div className="px-4 lg:px-0">
        <div className="pt-2 pb-5">
          <h1 className="text-[clamp(30px,8.6vw,38px)] leading-[1.04] tracking-[-0.035em]">
            <span className="font-light">Dream it up,</span>
            <br />
            <span className="font-extrabold">together</span>
          </h1>
          {status === 'ready' && ideas.length > 0 && (
            <p className="text-ink-2 mt-2 text-[16px]">
              {ideas.length} {ideas.length === 1 ? 'idea' : 'ideas'} · {chosen} chosen
            </p>
          )}
        </div>

        <Button size="lg" block icon={<Plus size={20} aria-hidden />} onClick={() => setAdding(true)} className="mb-5">
          Add an idea
        </Button>

        {status === 'loading' ? (
          <div className="py-10 text-center">
            <Spinner label="Loading wishlist" />
          </div>
        ) : status === 'error' ? (
          <ErrorPanel message={error ?? 'Couldn’t load the wishlist.'} onRetry={() => void reload()} />
        ) : (
          <>
            {!hasOriginal && (
              <div className="bg-surface-2 mb-5 flex flex-col gap-3 rounded-[var(--radius-card)] p-5">
                <p className="font-bold">Bring across your sheet’s 20 ideas</p>
                <p className="text-ink-2 -mt-2 text-[15px]">The rug, the air fryer, the festoon lights… from the Flat Quest Google Sheet.</p>
                <Button variant="secondary" loading={importing} icon={<FileDown size={18} aria-hidden />} onClick={() => void runImport()} className="self-start">
                  Bring them across
                </Button>
              </div>
            )}

            {ideas.length > 0 && (
              <div className="mb-4 max-w-md">
                <Segmented
                  label="Sort ideas"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: 'popular', label: 'Popular' },
                    { value: 'newest', label: 'Newest' },
                    { value: 'chosen', label: 'Chosen', count: chosen },
                  ]}
                />
              </div>
            )}

            {ideas.length === 0 ? (
              <EmptyState title="No ideas yet" body="Add something you’d love for the flat. Everyone can vote on it." />
            ) : list.length === 0 ? (
              <EmptyState title="Nothing chosen yet" body="When everyone agrees on an idea, open it and tick Chosen." />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <AnimatePresence initial={false}>
                  {list.map((idea) => (
                    <IdeaCard key={idea.id} idea={idea} room={idea.room_id ? roomById.get(idea.room_id) : undefined} onOpen={setOpen} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </>
        )}
      </div>
      <IdeaSheet open={open !== null} idea={open} onClose={() => setOpen(null)} />
      <IdeaSheet open={adding} idea={null} onClose={() => setAdding(false)} />
    </>
  )
}
