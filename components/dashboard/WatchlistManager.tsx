'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
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
import type { Watchlist } from '@/types'

interface WatchlistManagerProps {
  watchlists: Watchlist[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string, description?: string) => Promise<{ error: unknown }>
  onDelete: (id: string) => Promise<{ error: unknown }>
  onRename: (id: string, name: string) => Promise<{ error: unknown }>
}

export function WatchlistManager({
  watchlists,
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

      {watchlists.map((wl) => (
        <div
          key={wl.id}
          className={`group flex items-center gap-1 rounded-md px-2 py-1.5 cursor-pointer transition-colors
            ${selectedId === wl.id ? 'bg-primary/10 text-primary' : 'hover:bg-accent'}`}
          onClick={() => onSelect(wl.id)}
        >
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

          <div className="hidden group-hover:flex items-center gap-0.5">
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
              onClick={(e) => {
                e.stopPropagation()
                onDelete(wl.id)
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}

      {watchlists.length === 0 && (
        <p className="px-2 text-xs text-muted-foreground">
          No watchlists yet. Create one to get started.
        </p>
      )}
    </div>
  )
}
