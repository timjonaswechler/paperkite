import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Field } from "./Controls";

export const parseTags = (text: string) => [
  ...new Set(
    text
      .split(",")
      .map((tag) => tag.trim().normalize("NFC").toLowerCase())
      .filter(Boolean),
  ),
];
export function tagsError(text: string) {
  const tags = parseTags(text);
  return tags.length > 20
    ? "Maximal 20 Tags."
    : tags.some((tag) => tag.length > 40)
      ? "Ein Tag darf maximal 40 Zeichen enthalten."
      : "";
}
export function DocumentTags({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const error = tagsError(value);
  return (
    <Field label="Tags">
      <Input
        aria-label="Tags"
        placeholder="z. B. zeugnis, ausbildung"
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Mit Komma trennen · maximal 20 Tags mit je 40 Zeichen. Tags werden kleingeschrieben und
        doppelte entfernt.
      </p>
      <div className="flex flex-wrap gap-1">
        {parseTags(value).map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      )}
    </Field>
  );
}
