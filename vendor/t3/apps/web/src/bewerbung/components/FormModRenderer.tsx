import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
import { randomUUID } from "~/lib/utils";
import type { CvBlock } from "../shared/api";
import type { FormSpec, FormNode, Values, Entry } from "../../../../../../../shared/cv-form";
import { unmapped } from "../../../../../../../shared/cv-form";
import { CvContentEditor } from "./CvContentEditor";
import styles from "./form-mod.module.css";

export function FormModRenderer({
  spec,
  values,
  onChange,
  reading = false,
  disabled = false,
}: {
  spec: FormSpec;
  values: Values;
  onChange: (values: Values) => void;
  reading?: boolean;
  disabled?: boolean;
}) {
  const editable = !reading && !disabled;
  function render(nodes: FormNode[], data: Values, change: (v: Values) => void, prefix: string) {
    return nodes.map((node, index) => {
      const id = prefix + "-" + index;
      if (node.type === "group" || node.type === "columns")
        return (
          <section
            key={id}
            className={node.type === "columns" ? styles.columns : styles.group}
            aria-label={node.label}
          >
            {!reading && <h3 className="text-sm font-medium">{node.label}</h3>}
            <div>{render(node.children, data, change, id)}</div>
          </section>
        );
      if (node.type === "entries") {
        const entries = (data[node.key] || []) as Entry[];
        const update = (next: Entry[]) => change({ ...data, [node.key]: next });
        return (
          <section
            key={id}
            className={styles.collection}
            data-collection={node.key}
            aria-label={node.label}
          >
            {!reading && <h3 className="text-base font-medium">{node.label}</h3>}
            {entries
              .filter((e) => !reading || e.included)
              .map((entry) => {
                const at = entries.findIndex((e) => e.id === entry.id);
                return (
                  <article
                    key={entry.id}
                    className={styles.entry}
                    data-entry={entry.id}
                    data-included={entry.included}
                  >
                    {!reading && (
                      <div className={styles.actions}>
                        <label
                          htmlFor={"include-" + entry.id}
                          className="flex items-center gap-2 text-xs"
                        >
                          <Checkbox
                            id={"include-" + entry.id}
                            checked={entry.included}
                            disabled={disabled}
                            onCheckedChange={(checked) =>
                              update(
                                entries.map((e) =>
                                  e.id === entry.id ? { ...e, included: checked } : e,
                                ),
                              )
                            }
                          />
                          Im PDF
                        </label>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={!editable || at === 0}
                          aria-label="Nach oben"
                          onClick={() => {
                            const next = [...entries];
                            [next[at - 1], next[at]] = [next[at]!, next[at - 1]!];
                            update(next);
                          }}
                        >
                          ↑
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={!editable || at === entries.length - 1}
                          aria-label="Nach unten"
                          onClick={() => {
                            const next = [...entries];
                            [next[at], next[at + 1]] = [next[at + 1]!, next[at]!];
                            update(next);
                          }}
                        >
                          ↓
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost-destructive"
                          disabled={!editable}
                          aria-label="Eintrag löschen"
                          onClick={() => update(entries.filter((e) => e.id !== entry.id))}
                        >
                          Löschen
                        </Button>
                      </div>
                    )}
                    {render(
                      node.children,
                      entry.values,
                      (v) =>
                        update(entries.map((e) => (e.id === entry.id ? { ...e, values: v } : e))),
                      entry.id,
                    )}
                  </article>
                );
              })}
            {!reading && (
              <Button
                variant="outline"
                size="sm"
                disabled={!editable}
                onClick={() =>
                  update([...entries, { id: randomUUID(), included: true, values: {} }])
                }
              >
                Eintrag hinzufügen
              </Button>
            )}
          </section>
        );
      }
      if (reading && node.target === "metadata") return null;
      const value = data[node.key];
      return (
        <div key={id} className={styles.field} data-field={node.key}>
          {!reading && (
            <label className="text-xs text-muted-foreground" htmlFor={id}>
              {node.label}
              {node.required ? " *" : ""}
              {node.target === "metadata" ? " · nur Formular" : ""}
            </label>
          )}
          {node.type === "text" ? (
            reading ? (
              <p>{String(value || "")}</p>
            ) : (
              <Input
                id={id}
                aria-label={node.label}
                value={typeof value === "string" ? value : ""}
                disabled={disabled}
                onChange={(e) => change({ ...data, [node.key]: e.target.value })}
              />
            )
          ) : (
            <CvContentEditor
              label={node.label}
              showLabel={false}
              value={(value || []) as CvBlock[]}
              readonly={!editable}
              onChange={(content) => change({ ...data, [node.key]: content })}
            />
          )}
        </div>
      );
    });
  }
  const missing = unmapped(spec, values);
  return (
    <div className={styles.form} data-form-mod data-reading={reading}>
      {missing.length > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          Nicht zugeordnet, aber erhalten: {missing.join(", ")}
        </p>
      )}
      {render(spec.form, values, onChange, "form")}
    </div>
  );
}
