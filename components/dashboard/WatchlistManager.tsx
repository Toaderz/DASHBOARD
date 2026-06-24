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
import { useToast } from '@/components/ui/toast'
import type { Watchlist } from '@/types'

interface WatchlistManagerProps {
  watchlists: Watchlist[]
  currentUserId: string | null
  selectedId: string | null
  ownerEmails: Record<string, string>
  onSelect: (id: string) => void
  onCreate: (name: string, description?: string) => Promise<{ error: unknown }>
  onDelete: (id: string) => Promise<{ error: unknown }>
  onRename: (id: string, name: string) => Promise<{ error: unknown }>
  onLeave: (id: string) => Promise<{ error: unknown }>
}

export function WatchlistManager({
  watchlists,
  currentUserId,
  selectedId,
  ownerEmails,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onLeave,
}: WatchlistManagerProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const [leaveConfirmId, setLeaveConfirmId] = useState<string | null>(null)
  const [shareWatchlistId, setShareWatchlistId] = useState<string | null>(null)
  const [shareEmail, setShareEmail] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [teamShareLoading, setTeamShareLoading] = useState(false)
  const [teamShareMsg, setTeamShareMsg] = useState<string | null>(null)

  const { shares, addShare, removeShare, addTeamShares } = useWatchlistShares(shareWatchlistId)
  const { toast } = useToast()

  const handleCreate = async () => {
    if (!createName.trim()) return
    setCreating(true)
    setCreateError(null)
    const name = createName.trim()
    const { error } = await onCreate(name, createDesc.trim() || undefined)
    if (error) {
      const msg = (error as { message?: string })?.message ?? 'Error desconocido'
      setCreateError(msg)
      setCreating(false)
      return
    }
    setCreateName('')
    setCreateDesc('')
    setCreating(false)
    setCreateOpen(false)
    toast({ title: 'Watchlist creada', description: name, variant: 'success' })
  }

  const handleDelete = async (wl: Watchlist) => {
    const { error } = await onDelete(wl.id)
    toast(error
      ? { title: 'No se pudo eliminar', description: wl.name, variant: 'error' }
      : { title: 'Watchlist eliminada', description: wl.name, variant: 'success' })
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
    setTeamShareMsg(null)
  }

  const handleTeamShare = async () => {
    setTeamShareLoading(true)
    setTeamShareMsg(null)
    const { error, count } = await addTeamShares()
    if (error) {
      setTeamShareMsg(error)
    } else if (count === 0) {
      setTeamShareMsg('Ya está compartida con todo el equipo')
    } else {
      setTeamShareMsg(`Compartida con ${count} miembro${count !== 1 ? 's' : ''} del equipo`)
    }
    setTeamShareLoading(false)
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
      toast({ title: 'Watchlist compartida', description: 'El usuario ya puede verla.', variant: 'success' })
    }
    setShareLoading(false)
  }

  return (
    <div className="flex flex-col gap-1" data-tour="watchlists">
      <div className="mb-1 flex items-center justify-between px-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          Watchlists
        </span>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost-dim" size="sm" className="h-6 w-6 p-0" data-tour="add-ticker">
              <Plus className="h-3.5 w-3.5" />
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
        const ownerEmail = !isOwned ? ownerEmails[wl.user_id] : undefined
        const ownerHandle = ownerEmail ? `@${ownerEmail.split('@')[0]}` : null

        return (
          <div
            key={wl.id}
            className={`group flex items-center gap-1 rounded-sm px-2 min-h-[44px] cursor-pointer transition-colors
              ${selectedId === wl.id ? 'bg-bone/[0.08] text-foreground' : 'hover:bg-foreground/[0.05] text-foreground'}`}
            onClick={() => onSelect(wl.id)}
          >
            {!isOwned && (
              <Users className="h-3 w-3 shrink-0 text-muted-foreground mt-0.5" />
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
              <div className="flex-1 min-w-0">
                <span className="block truncate font-ui text-sm">{wl.name}</span>
                {ownerHandle && (
                  <span className="block truncate font-mono text-[10px] text-muted-foreground/70 leading-tight">
                    de {ownerHandle}
                  </span>
                )}
              </div>
            )}

            {isOwned && (
              <div className="flex items-center gap-0.5 md:hidden md:group-hover:flex">
                <Button
                  variant="ghost-dim"
                  size="sm"
                  className="h-6 w-6 p-0"
                  title="Compartir"
                  onClick={(e) => { e.stopPropagation(); openShare(wl.id) }}
                >
                  <Share2 className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost-dim"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingId(wl.id)
                    setEditName(wl.name)
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => { e.stopPropagation(); handleDelete(wl) }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}

            {!isOwned && (
              <Button
                variant="ghost-dim"
                size="sm"
                title="Dejar de seguir esta lista"
                className="h-6 w-6 p-0 md:hidden md:group-hover:flex shrink-0 hover:text-loss"
                onClick={(e) => { e.stopPropagation(); setLeaveConfirmId(wl.id) }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        )
      })}

      {watchlists.length === 0 && (
        <p className="px-2 text-xs text-muted-foreground">
          No watchlists yet. Create one to get started.
        </p>
      )}

      {/* Leave confirmation dialog */}
      <Dialog open={leaveConfirmId !== null} onOpenChange={(open) => { if (!open) setLeaveConfirmId(null) }}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Dejar de seguir lista</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            ¿Deseas dejar de seguir esta lista? Podrás volver a acceder a ella si te la comparten de nuevo.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLeaveConfirmId(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (leaveConfirmId) {
                  const { error } = await onLeave(leaveConfirmId)
                  toast(error
                    ? { title: 'No se pudo completar', variant: 'error' }
                    : { title: 'Dejaste de seguir la lista', variant: 'info' })
                }
                setLeaveConfirmId(null)
              }}
            >
              Dejar de seguir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Team Evolve</p>
                <p className="text-xs text-muted-foreground">Compartir con todos los miembros</p>
              </div>
              <Button
                onClick={handleTeamShare}
                disabled={teamShareLoading}
                size="sm"
                variant="outline"
                className="shrink-0 ml-3"
              >
                {teamShareLoading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <><Users className="mr-1.5 h-3.5 w-3.5" />Compartir</>}
              </Button>
            </div>
            {teamShareMsg && (
              <p className="text-xs text-muted-foreground">{teamShareMsg}</p>
            )}

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
