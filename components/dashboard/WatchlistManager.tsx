'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, Loader2, Share2, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { useWatchlistShares } from '@/hooks/useWatchlistAssets'
import type { Watchlist } from '@/types'

interface WatchlistManagerProps {
  watchlists: Watchlist[]
  currentUserId: string | null
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string, description?: string) => Promise<{ error: unknown }>
  onDelete: (id: string) => Promise<{ error: unknown }>
  onRename: (id: string, name: string) => Promise<{ error: unknown }>
}

export function WatchlistManager({
  watchlists,
  currentUserId,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: WatchlistManagerProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const [shareWatchlistId, setShareWatchlistId] = useState<string | null>(null)
  const [shareEmail, setShareEmail] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  const { shares, addShare, removeShare } = useWatchlistShares(shareWatchlistId)

  const handleCreate = async () => {
    if (!createName.trim()) return
    setCreating(true)
    setCreateError(null)
    const { error } = await onCreate(createName.trim(), createDesc.trim() || undefined)
    if (error) {
      setCreateError('Error al crear la watchlist. Intenta de nuevo.')
      setCreating(false)
      return
    }
    setCreateName('')
    setCreateDesc('')
    setCreating(false)
    setCreateOpen(false)
  }

  const handleRename = async (id: string) => {
    if (!editName.trim()) return
    await onRename(id, editName.trim())
    setEditingId(null)
  }

  const openShare = (id: string) => {
    setShareWatchlistId(id)
    setShareEmail('')
    setShareError(null)
  }

  const closeShare = () => {
    setShareWatchlistId(null)
    setShareEmail('')
    setShareError(null)
  }

  const handleAddShare = async () => {
    if (!shareEmail.trim()) return
    setShareLoading(true)
    setShareError(null)
    const { error } = await addShare(shareEmail.trim())
    if (error) {
      setShareError(error)
    } else {
      setShareEmail('')
    }
    setShareLoading(false)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Watchlists
        </span>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Nueva Watchlist</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label htmlFor="wl-name">Nombre</Label>
                <Input
                  id="wl-name"
                  placeholder="Ej. Acciones USA"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="wl-desc">Descripción (opcional)</Label>
                <Input
                  id="wl-desc"
                  placeholder="Descripción corta"
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                />
              </div>
              {createError && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {createError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Crear
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {watchlists.map((wl) => {
        const isOwned = currentUserId != null && wl.user_id === currentUserId
        return (
          <div
            key={wl.id}
            className={`group flex items-center gap-1 rounded-md px-2 py-1.5 cursor-pointer transition-colors
              ${selectedId === wl.id ? 'bg-primary/10 text-primary' : 'hover:bg-accent'}`}
            onClick={() => onSelect(wl.id)}
          >
            {!isOwned && (
              <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}

            {editingId === wl.id ? (
              <Input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => handleRename(wl.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(wl.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
                className="h-6 py-0 text-sm"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="flex-1 truncate text-sm">{wl.name}</span>
            )}

            {isOwned && (
              <div className="hidden group-hover:flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  title="Compartir"
                  onClick={(e) => { e.stopPropagation(); openShare(wl.id) }}
                >
                  <Share2 className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingId(wl.id)
                    setEditName(wl.name)
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); onDelete(wl.id) }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        )
      })}

      {watchlists.length === 0 && (
        <p className="px-2 text-xs text-muted-foreground">
          No watchlists yet. Create one to get started.
        </p>
      )}

      {/* Share Dialog */}
      <Dialog open={shareWatchlistId !== null} onOpenChange={(open) => { if (!open) closeShare() }}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Compartir watchlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Compartir con un usuario</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="email@ejemplo.com"
                  value={shareEmail}
                  onChange={(e) => { setShareEmail(e.target.value); setShareError(null) }}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddShare()}
                />
                <Button
                  onClick={handleAddShare}
                  disabled={shareLoading || !shareEmail.trim()}
                  size="sm"
                  className="shrink-0"
                >
                  {shareLoading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : 'Compartir'}
                </Button>
              </div>
              {shareError && (
                <p className="text-sm text-destructive">{shareError}</p>
              )}
            </div>

            {shares.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Compartido con:</p>
                {shares.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center justify-between rounded-md bg-muted px-2 py-1.5"
                  >
                    <span className="text-sm truncate">
                      {share.profiles?.[0]?.email ?? share.shared_with_user_id}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 ml-2 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeShare(share.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
