import { ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { randomUUID } from "~/lib/utils";
import type { CvBlock } from "../shared/api";
import type { FormSpec, FormNode, Values, Entry } from "../../../../../../../shared/cv-form";
import { unmapped } from "../../../../../../../shared/cv-form";
import { CvContentEditor } from "./CvContentEditor";
import { CvEditable } from "./CvEditable";
import documentStyles from "./cv-editor.module.css";
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
            {!reading && <h3 className={styles.heading}>{node.label}</h3>}
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
            {!reading && <h3 className={styles.heading}>{node.label}</h3>}
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
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <Checkbox
                            id={"include-" + entry.id}
                            aria-label="Im PDF"
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
                          {entry.included ? "Im PDF" : "Nicht im PDF"}
                        </label>
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          disabled={!editable || at === 0}
                          aria-label="Nach oben"
                          onClick={() => {
                            const next = [...entries];
                            [next[at - 1], next[at]] = [next[at]!, next[at - 1]!];
                            update(next);
                          }}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          disabled={!editable || at === entries.length - 1}
                          aria-label="Nach unten"
                          onClick={() => {
                            const next = [...entries];
                            [next[at], next[at + 1]] = [next[at + 1]!, next[at]!];
                            update(next);
                          }}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          disabled={!editable}
                          aria-label="Eintrag löschen"
                          onClick={() => {
                            if (confirm("Diesen Eintrag dauerhaft aus dem Lebenslauf entfernen?"))
                              update(entries.filter((e) => e.id !== entry.id));
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                    <div className={styles.entryContent}>
                      {render(
                        node.children,
                        entry.values,
                        (v) =>
                          update(entries.map((e) => (e.id === entry.id ? { ...e, values: v } : e))),
                        entry.id,
                      )}
                    </div>
                  </article>
                );
              })}
            {!reading && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!editable}
                  onClick={() =>
                    update([...entries, { id: randomUUID(), included: true, values: {} }])
                  }
                >
                  <Plus />
                  Eintrag hinzufügen
                </Button>
              </div>
            )}
          </section>
        );
      }
      if (reading && node.target === "metadata") return null;
      const value = data[node.key];
      return (
        <div key={id} className={styles.field} data-field={node.key} data-target={node.target}>
          {node.type === "text" ? (
            <CvEditable
              label={node.label}
              value={typeof value === "string" ? value : ""}
              readonly={!editable}
              showLabel={!reading}
              required={Boolean(node.required)}
              hint={node.target === "metadata" ? " · nur Formular" : ""}
              onChange={(text) => change({ ...data, [node.key]: text })}
            />
          ) : (
            <>
              {!reading && (
                <span className={documentStyles["cv-field-label"]} aria-hidden>
                  {node.label}
                  {node.required ? " *" : ""}
                  {node.target === "metadata" ? " · nur Formular" : ""}
                </span>
              )}
              <CvContentEditor
                label={node.label}
                showLabel={false}
                value={(value || []) as CvBlock[]}
                readonly={!editable}
                onChange={(content) => change({ ...data, [node.key]: content })}
              />
            </>
          )}
        </div>
      );
    });
  }
  const missing = unmapped(spec, values);
  return (
    <article
      className={`${documentStyles["cv-document"]} ${styles.form} rounded-lg border bg-card p-4 sm:p-6`}
      aria-label="Direkt bearbeitbares Vorlagenformular"
      data-form-mod
      data-reading={reading}
    >
      {missing.length > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          Nicht zugeordnet, aber erhalten: {missing.join(", ")}
        </p>
      )}
      {render(spec.form, values, onChange, "form")}
    </article>
  );
}
