'use client'

import { DndContext, closestCenter, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { PriceSuggestion } from '../useSuggestedPrices'
import SortableItem from './SortableItem'
import { labelStyle, type MenuItem } from './menuTypes'

// The right column of the Menu Manager: the active category's items, in the
// order a drag puts them.
export default function ItemList({
  categoryName, activeCategory, activeCatItems, loading, sensors, onDragEnd,
  suggestions, onEdit, onDelete, isMobile,
}: {
  categoryName: string
  activeCategory: string
  activeCatItems: MenuItem[]
  loading: boolean
  sensors: SensorDescriptor<SensorOptions>[]
  onDragEnd: (event: DragEndEvent) => void
  suggestions: Record<string, PriceSuggestion | undefined>
  onEdit: (item: MenuItem) => void
  onDelete: (id: string) => void
  isMobile: boolean
}) {
  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
      }}>
        <p style={{ ...labelStyle, margin: 0 }}>
          {categoryName}
          <span style={{ color: 'rgba(var(--offwhite-rgb),0.2)', marginLeft: '0.5rem' }}>
            ({activeCatItems.length} items) — drag to reorder
          </span>
        </p>
      </div>

      {loading ? (
        <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
      ) : !activeCategory ? (
        <div style={{
          border: '1px dashed rgba(var(--overlay-rgb),0.08)',
          borderRadius: '4px',
          padding: '3rem',
          textAlign: 'center',
          color: 'rgba(var(--offwhite-rgb),0.2)',
          fontFamily: 'var(--font-inter)',
          fontSize: '0.85rem',
        }}>Select or create a category on the left</div>
      ) : activeCatItems.length === 0 ? (
        <div style={{
          border: '1px dashed rgba(var(--overlay-rgb),0.08)',
          borderRadius: '4px',
          padding: '3rem',
          textAlign: 'center',
          color: 'rgba(var(--offwhite-rgb),0.2)',
          fontFamily: 'var(--font-inter)',
          fontSize: '0.85rem',
        }}>No items yet — click + Add Item to get started</div>
      ) : (
        <div style={{
          background: 'rgba(var(--overlay-rgb),0.02)',
          border: '1px solid rgba(var(--overlay-rgb),0.06)',
          borderRadius: '4px',
          overflow: 'hidden',
        }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={activeCatItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
              {activeCatItems.map(item => (
                <SortableItem key={item.id} item={item} suggestion={suggestions[item.id]} onEdit={onEdit} onDelete={onDelete} isMobile={isMobile} />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  )
}
