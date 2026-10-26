import { Images, LayoutGrid, Video } from "lucide-react";

export type GalleryMediaFilterValue = "all" | "image" | "video";

interface GalleryMediaFilterProps {
  value: GalleryMediaFilterValue;
  onChange: (value: GalleryMediaFilterValue) => void;
}

const options: {
  value: GalleryMediaFilterValue;
  label: string;
  icon: typeof LayoutGrid;
}[] = [
  { value: "all", label: "All", icon: LayoutGrid },
  { value: "image", label: "Photos", icon: Images },
  { value: "video", label: "Videos", icon: Video },
];

export default function GalleryMediaFilter({ value, onChange }: GalleryMediaFilterProps) {
  return (
    <div
      role="group"
      aria-label="Filter gallery media"
      className="inline-flex min-w-0 max-w-full items-center gap-1"
    >
      {options.map(({ value: option, label, icon: Icon }) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={`inline-flex min-h-11 min-w-0 shrink items-center justify-center gap-1.5 rounded-sm border px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-3 ${
              selected
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border text-foreground/80 hover:border-primary/50 hover:text-primary"
            }`}
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
