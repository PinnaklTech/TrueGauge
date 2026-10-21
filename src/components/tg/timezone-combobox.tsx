import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  filterTimezoneOptions,
  timezoneDisplayLabel,
} from "@/lib/format-settings";
import { cn } from "@/lib/utils";

type Props = {
  id?: string;
  value: string;
  onChange: (iana: string) => void;
  /** Allow empty selection (e.g. "use org default") */
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function TimezoneCombobox({
  id,
  value,
  onChange,
  allowEmpty,
  emptyLabel = "Use organization default",
  disabled,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const options = useMemo(() => filterTimezoneOptions(query), [query]);

  const triggerLabel = value
    ? timezoneDisplayLabel(value)
    : allowEmpty
      ? emptyLabel
      : "Select timezone…";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between px-3 font-normal shadow-sm",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-left">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search CST, IST, Eastern, Chicago…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No timezone matches “{query.trim() || "…"}”.</CommandEmpty>
            <CommandGroup>
              {allowEmpty ? (
                <CommandItem
                  value="__org_default__"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value ? "opacity-0" : "opacity-100")}
                  />
                  <span className="truncate">{emptyLabel}</span>
                </CommandItem>
              ) : null}
              {options.map((z) => (
                <CommandItem
                  key={z.value}
                  // Include label in value so cmdk search stays useful if filtering re-enabled
                  value={`${z.value} ${z.label}`}
                  onSelect={() => {
                    // Use closed-over IANA id — cmdk lowercases the select argument
                    onChange(z.value);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === z.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{z.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
