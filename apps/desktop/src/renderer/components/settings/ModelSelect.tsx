import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ModelOption = { id: string; name: string };

/**
 * The connect dialog's model field. A datalist stood here, which meant the one
 * field with hundreds of right answers was the one field that would not show
 * them — so it is a real select now, sized to the field it replaces.
 *
 * A hand-typed id is still reachable, because it has to be: a ClinePass tier, a
 * model newer than the catalog, a name only your own endpoint knows. The dialog
 * keeps whatever is selected, and a value the catalog does not list is carried as
 * its own item rather than silently reset to the first thing in the list.
 */
export function ModelSelectField({
  models,
  value,
  onChange,
  id,
}: {
  models: ModelOption[];
  value: string;
  onChange(model: string): void;
  id?: string;
}) {
  const options = useMemo(
    () => (value && !models.some((model) => model.id === value) ? [{ id: value, name: value }, ...models] : models),
    [models, value],
  );

  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger className="w-full" {...(id ? { id } : {})}>
        <SelectValue placeholder="Choose a model" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Models</SelectLabel>
          {options.map((model) => (
            /* The id is what gets saved, so a friendly name never stands in for
               it without the real thing beside it — as a hint, not as item text,
               or it would turn up in the closed field too. */
            <SelectItem key={model.id} value={model.id} {...(model.name === model.id ? {} : { hint: model.id })}>
              {model.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
