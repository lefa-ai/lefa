import { useEffect, useState } from 'react'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from '@/components/ui/combobox'
import type { ModelSummary } from '../../../shared/api'

export function ModelPicker({
  model,
  onChange
}: {
  model: string
  onChange: (model: string) => void
}): React.JSX.Element {
  const [models, setModels] = useState<readonly ModelSummary[]>([])

  useEffect(() => {
    let listening = true

    void window.lefa.models
      .list()
      .then((available) => {
        if (listening) setModels(available)
      })
      // The catalogue is a convenience. Losing it leaves the typed id working.
      .catch(() => undefined)

    return () => {
      listening = false
    }
  }, [])

  const ids = models.map((available) => available.id)
  const names = new Map(models.map((available) => [available.id, available.name]))

  return (
    <Combobox
      items={ids.length > 0 ? ids : [model]}
      value={model}
      onValueChange={(next) => {
        if (typeof next === 'string' && next) onChange(next)
      }}
    >
      <ComboboxInput
        aria-label="Model"
        placeholder="Choose a model"
        className="h-8 w-64 font-mono text-xs"
      />
      <ComboboxContent>
        <ComboboxEmpty>No matching model.</ComboboxEmpty>
        <ComboboxList>
          {(id: string) => (
            <ComboboxItem key={id} value={id} className="font-mono text-xs">
              {names.get(id) ?? id}
              <span className="ms-2 text-faint">{id}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
