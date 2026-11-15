import { CornerDownRight, MessageCircle, Pencil, SendHorizontal, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar } from '@/components/Avatar'
import { ConfirmSheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui'
import { useHousehold } from '@/household/HouseholdProvider'
import type { CommentRow } from '@/lib/database.types'
import { eventTime, findMentions } from '@/lib/events'
import { errorMessage, supabase } from '@/lib/supabase'

export type DiscussionTarget = { item_id: string } | { option_id: string } | { idea_id: string }

const MAX = 2000
type Local = CommentRow & { pending?: boolean }

function targetKey(t: DiscussionTarget): ['item_id' | 'option_id' | 'idea_id', string] {
  if ('item_id' in t) return ['item_id', t.item_id]
  if ('option_id' in t) return ['option_id', t.option_id]
  return ['idea_id', t.idea_id]
}

/**
 * Short, contextual conversation attached to one checklist item, product option or
 * wishlist idea. Plain text only; one level of replies; @mentions are limited to flatmates.
 * Uses no <form> of its own so it can sit inside the item editor's form.
 */
export function Discussion({ target, focusCommentId }: { target: DiscussionTarget; focusCommentId?: string | null }) {
  const { user } = useAuth()
  const { household, members, memberById } = useHousehold()
  const toast = useToast()
  const [column, id] = targetKey(target)
  const hid = household?.id ?? null
  const me = user?.id ?? null
  const [comments, setComments] = useState<Local[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [replyTo, setReplyTo] = useState<Local | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Local | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [flash, setFlash] = useState<string | null>(focusCommentId ?? null)
  const headingId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('comments').select('*').eq(column, id).order('created_at').limit(300)
    if (error) {
      setState((s) => (s === 'ready' ? s : 'error'))
      return
    }
    setComments((prev) => {
      const pending = prev.filter((c) => c.pending)
      return [...(data ?? []), ...pending]
    })
    setState('ready')
  }, [column, id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state is set when it resolves
    void load()
    const upsert = (row: CommentRow) =>
      setComments((prev) => {
        const i = prev.findIndex((c) => c.id === row.id)
        if (i === -1) return [...prev, row].sort((a, b) => a.created_at.localeCompare(b.created_at))
        const next = prev.slice()
        next[i] = row
        return next
      })
    const channel = supabase
      .channel(`comments:${column}:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `${column}=eq.${id}` }, (p) => upsert(p.new as CommentRow))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'comments', filter: `${column}=eq.${id}` }, (p) => upsert(p.new as CommentRow))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void load()
      })
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [column, id, load])

  // Arriving from a notification: bring that comment into view once.
  useEffect(() => {
    if (!flash || state !== 'ready') return
    if (!comments.some((c) => c.id === flash)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the target may be among the older, folded comments
    setShowAll(true)
    const t = window.setTimeout(() => {
      listRef.current?.querySelector(`[data-comment="${flash}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 120)
    const clear = window.setTimeout(() => setFlash(null), 2600)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(clear)
    }
  }, [flash, state, comments])

  const others = useMemo(
    () => members.filter((m) => m.userId !== me).map((m) => ({ id: m.userId, name: m.profile.display_name })),
    [members, me],
  )

  const threads = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_id)
    const replies = new Map<string, Local[]>()
    for (const c of comments) if (c.parent_id) replies.set(c.parent_id, [...(replies.get(c.parent_id) ?? []), c])
    return roots
      .map((root) => ({ root, replies: replies.get(root.id) ?? [] }))
      .filter((t) => !t.root.deleted_at || t.replies.some((r) => !r.deleted_at))
  }, [comments])
  const FOLD = 5
  const shown = showAll ? threads : threads.slice(-FOLD)

  const post = async (body: string, parent: Local | null): Promise<boolean> => {
    if (!hid || !me) return false
    const text = body.trim()
    if (!text) return false
    const tempId = `pending-${crypto.randomUUID()}`
    const mentions = findMentions(text, others)
    const optimistic: Local = {
      id: tempId,
      household_id: hid,
      item_id: column === 'item_id' ? id : null,
      option_id: column === 'option_id' ? id : null,
      idea_id: column === 'idea_id' ? id : null,
      parent_id: parent ? (parent.parent_id ?? parent.id) : null,
      author_id: me,
      author_name: null,
      body: text,
      mentions,
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      pending: true,
    }
    setComments((prev) => [...prev, optimistic])
    const { data, error } = await supabase
      .from('comments')
      .insert({
        household_id: hid,
        item_id: optimistic.item_id,
        option_id: optimistic.option_id,
        idea_id: optimistic.idea_id,
        parent_id: optimistic.parent_id,
        body: text,
        mentions,
      })
      .select()
      .single()
    if (error || !data) {
      setComments((prev) => prev.filter((c) => c.id !== tempId))
      toast.error(errorMessage(error, 'Your comment wasn’t posted. Try again.'))
      return false
    }
    // The realtime echo may already have added the saved row; never show both.
    setComments((prev) => {
      const without = prev.filter((c) => c.id !== tempId && c.id !== data.id)
      return [...without, data].sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
    return true
  }

  const saveEdit = async (comment: Local, body: string): Promise<boolean> => {
    const text = body.trim()
    if (!text) return false
    const before = comment
    const mentions = findMentions(text, others)
    setComments((prev) => prev.map((c) => (c.id === comment.id ? { ...c, body: text, mentions, edited_at: new Date().toISOString() } : c)))
    const { data, error } = await supabase.from('comments').update({ body: text, mentions }).eq('id', comment.id).select().single()
    if (error || !data) {
      setComments((prev) => prev.map((c) => (c.id === before.id ? before : c)))
      toast.error(errorMessage(error, 'Your edit wasn’t saved.'))
      return false
    }
    setComments((prev) => prev.map((c) => (c.id === data.id ? data : c)))
    setEditing(null)
    return true
  }

  const remove = async () => {
    const target = confirmDelete
    if (!target) return
    setDeleting(true)
    const { data, error } = await supabase.from('comments').update({ deleted_at: new Date().toISOString() }).eq('id', target.id).select().single()
    setDeleting(false)
    if (error || !data) {
      toast.error(errorMessage(error, 'That comment couldn’t be deleted.'))
      return
    }
    setComments((prev) => prev.map((c) => (c.id === data.id ? data : c)))
    setConfirmDelete(null)
  }

  const renderComment = (c: Local, isReply: boolean) => {
    const author = c.author_id ? memberById.get(c.author_id) : undefined
    const name = author?.profile.display_name || c.author_name || 'Former flatmate'
    const mine = c.author_id === me
    return (
      <li
        key={c.id}
        data-comment={c.id}
        data-testid="comment"
        className={`rounded-2xl transition-colors duration-700 ${flash === c.id ? 'bg-accent-soft' : ''} ${isReply ? 'mt-1 ml-11' : 'mt-3'}`}
      >
        <div className="flex gap-3 p-1">
          <Avatar profile={author?.profile ?? ({ display_name: name, accent_color: '#A3A3A8', avatar_path: null } as never)} size={isReply ? 28 : 34} decorative />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-tight">
              <span className="font-bold">{name}</span>
              <span className="text-ink-2">
                {' · '}
                {c.pending ? 'Sending…' : <time dateTime={c.created_at}>{eventTime(c.created_at)}</time>}
                {c.edited_at && !c.deleted_at ? ' · edited' : ''}
              </span>
            </p>
            {c.deleted_at ? (
              <p className="text-ink-2 mt-0.5 text-[15px] italic">Comment deleted</p>
            ) : editing === c.id ? (
              <Composer
                initial={c.body}
                people={others}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={(body) => saveEdit(c, body)}
                autoFocus
              />
            ) : (
              <p className="mt-0.5 text-[15px] leading-snug break-words whitespace-pre-wrap">
                <MentionText body={c.body} names={c.mentions.map((m) => memberById.get(m)?.profile.display_name).filter((n): n is string => Boolean(n))} />
              </p>
            )}
            {!c.deleted_at && !c.pending && editing !== c.id && (
              <div className="-ml-2 flex flex-wrap">
                <button type="button" onClick={() => setReplyTo(c)} className="pressable text-ink-2 min-h-9 rounded-lg px-2 text-[13px] font-bold">
                  Reply
                </button>
                {mine && (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(c.id)}
                      className="pressable text-ink-2 inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[13px] font-bold"
                    >
                      <Pencil size={13} aria-hidden /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(c)}
                      className="pressable text-ink-2 inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[13px] font-bold"
                    >
                      <Trash2 size={13} aria-hidden /> Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </li>
    )
  }

  return (
    <section aria-labelledby={headingId} className="mt-1" data-testid="discussion">
      <h3 id={headingId} className="flex items-center gap-2 text-[15px] font-bold">
        <MessageCircle size={18} aria-hidden />
        Discussion
        {threads.length > 0 && <span className="text-ink-2 font-semibold tabular-nums">· {comments.filter((c) => !c.deleted_at).length}</span>}
      </h3>
      <div ref={listRef}>
        {state === 'loading' && <p className="text-ink-2 mt-2 text-[14px]">Loading comments…</p>}
        {state === 'error' && (
          <p className="text-ink-2 mt-2 text-[14px]" role="status">
            Comments couldn’t load.{' '}
            <button type="button" className="text-accent-ink font-bold underline" onClick={() => void load()}>
              Try again
            </button>
          </p>
        )}
        {state === 'ready' && threads.length === 0 && (
          <p className="text-ink-2 mt-1 text-[14px]">No comments yet. Ask a question or share a thought — use @ to bring someone in.</p>
        )}
        {threads.length > shown.length && (
          <button type="button" onClick={() => setShowAll(true)} className="pressable text-accent-ink mt-2 min-h-10 rounded-lg text-[14px] font-bold">
            Show {threads.length - shown.length} earlier
          </button>
        )}
        <ul>
          {shown.map(({ root, replies }) => [renderComment(root, false), ...replies.map((r) => renderComment(r, true))])}
        </ul>
      </div>
      {replyTo && (
        <p className="bg-surface-2 mt-3 flex items-center gap-2 rounded-xl py-1 pr-1 pl-3 text-[13px] font-semibold">
          <CornerDownRight size={15} aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Replying to {memberById.get(replyTo.author_id ?? '')?.profile.display_name ?? replyTo.author_name ?? 'comment'}
          </span>
          <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)} className="pressable inline-flex h-9 w-9 items-center justify-center rounded-full">
            <X size={16} aria-hidden />
          </button>
        </p>
      )}
      <div className="mt-2">
        <Composer
          key={replyTo?.id ?? 'root'}
          people={others}
          placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
          submitLabel="Send"
          autoFocus={Boolean(replyTo)}
          onSubmit={async (body) => {
            const ok = await post(body, replyTo)
            if (ok) setReplyTo(null)
            return ok
          }}
        />
      </div>
      <ConfirmSheet
        open={confirmDelete !== null}
        title="Delete this comment?"
        body="It will be removed for everyone. Replies stay in place."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={remove}
        onClose={() => setConfirmDelete(null)}
      />
    </section>
  )
}

/** Plain text with recognised @Name mentions emphasised. Never renders HTML. */
function MentionText({ body, names }: { body: string; names: string[] }) {
  if (names.length === 0) return <>{body}</>
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length)
  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = body.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'giu'))
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="text-accent-ink font-bold">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

function Composer({
  initial = '',
  people,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  initial?: string
  people: { id: string; name: string }[]
  placeholder?: string
  submitLabel: string
  onSubmit: (body: string) => Promise<boolean>
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState(initial)
  const [sending, setSending] = useState(false)
  const [caret, setCaret] = useState(initial.length)
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId()

  // "@Ma" just before the caret → suggest flatmates whose name starts with "Ma".
  const query = useMemo(() => {
    const before = text.slice(0, caret)
    const m = /(?:^|\s)@([\p{L}\p{N}'’-]{0,20})$/u.exec(before)
    return m ? m[1]!.toLowerCase() : null
  }, [text, caret])
  const suggestions = query === null ? [] : people.filter((p) => p.name.toLowerCase().startsWith(query)).slice(0, 5)

  const pick = (name: string) => {
    const before = text.slice(0, caret).replace(/@[\p{L}\p{N}'’-]{0,20}$/u, `@${name} `)
    const next = before + text.slice(caret)
    setText(next)
    setCaret(before.length)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(before.length, before.length)
    })
  }

  const submit = async () => {
    if (sending || !text.trim()) return
    setSending(true)
    const draft = text
    setText('')
    const ok = await onSubmit(draft)
    setSending(false)
    // Keep what was typed if it didn't go through.
    if (!ok) setText(draft)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape' && onCancel) {
      e.stopPropagation()
      onCancel()
    }
  }

  const over = text.length > MAX
  return (
    <div className="relative">
      {suggestions.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Mention a flatmate" className="bg-surface border-line absolute bottom-full left-0 z-10 mb-1 w-56 rounded-2xl border p-1">
          {suggestions.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p.name)}
                className="pressable active:bg-surface-2 hover:bg-surface-2 flex min-h-11 w-full items-center rounded-xl px-3 text-left text-[15px] font-semibold"
              >
                @{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={text}
          autoFocus={autoFocus}
          rows={1}
          aria-label={placeholder ?? 'Edit comment'}
          aria-controls={suggestions.length > 0 ? listId : undefined}
          placeholder={placeholder}
          maxLength={MAX + 200}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart ?? e.target.value.length)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKey}
          className="field max-h-40 min-h-12 flex-1 resize-none py-3 [field-sizing:content]"
        />
        {onCancel ? (
          <div className="flex shrink-0 gap-1">
            <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" size="sm" loading={sending} disabled={!text.trim() || over} onClick={() => void submit()}>
              {submitLabel}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            aria-label={submitLabel}
            disabled={!text.trim() || over || sending}
            onClick={() => void submit()}
            className="pressable bg-accent disabled:bg-accent/40 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-on-accent"
          >
            <SendHorizontal size={20} aria-hidden />
          </button>
        )}
      </div>
      {text.length > MAX - 200 && (
        <p className={`mt-1 text-right text-[12px] tabular-nums ${over ? 'text-danger font-bold' : 'text-ink-2'}`}>
          {text.length}/{MAX}
        </p>
      )}
    </div>
  )
}
