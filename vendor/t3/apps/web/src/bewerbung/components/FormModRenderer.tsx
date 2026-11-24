import { randomUUID } from "~/lib/utils";
import type { CvBlock } from "../shared/api";
import type { FormSpec, FormNode, Values, Entry } from "../../../../../../../shared/cv-form";
import { unmapped } from "../../../../../../../shared/cv-form";
import { CvContentEditor } from "./CvContentEditor";
import { CvEditable } from "./CvEditable";
import { EntryCollection } from "./EntryCollection";
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
  function render(
    nodes: FormNode[],
    data: Values,
    change: (v: Values) => void,
    prefix: string,
    inEntry = false,
  ) {
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
            <div>{render(node.children, data, change, id, inEntry)}</div>
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
            <EntryCollection
              entries={entries}
              onChange={update}
              label={node.label}
              reading={reading}
              disabled={disabled}
              createEntry={() => ({ id: randomUUID(), included: true, values: {} })}
            >
              {(entry) => (
                <div className={styles.entryContent}>
                  {render(
                    node.children,
                    entry.values,
                    (v) =>
                      update(entries.map((e) => (e.id === entry.id ? { ...e, values: v } : e))),
                    entry.id,
                    true,
                  )}
                </div>
              )}
            </EntryCollection>
          </section>
        );
      }
      if (reading && node.target === "metadata") return null;
      const value = data[node.key];
      const profileBound = !inEntry && Boolean(spec.applicant?.fields[node.key]);
      return (
        <div key={id} className={styles.field} data-field={node.key} data-target={node.target}>
          {node.type === "text" ? (
            <CvEditable
              label={node.label}
              value={typeof value === "string" ? value : ""}
              readonly={!editable || profileBound}
              showLabel={!reading}
              required={Boolean(node.required)}
              hint={
                profileBound
                  ? " · Bewerberprofil"
                  : node.target === "metadata"
                    ? " · nur Formular"
                    : ""
              }
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
