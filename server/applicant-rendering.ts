import type {
  ApplicantBindings,
  ApplicantProfile,
  CoverLetter,
  CvData,
} from "../shared/api.ts";
import type { Values } from "../shared/cv-form.ts";
import { applicantVariables } from "../shared/applicant-profile.ts";
import { escapeCoverText } from "./cover-letter.ts";
import { luaData } from "./cv-mod-prototype/model.ts";
import { check } from "./files.ts";

export const applicantReservedFiles = [
  "applicant-data.tex",
  "applicant-data.lua",
  "applicant-signature.png",
];
export type ApplicantRenderContext = {
  profile: ApplicantProfile;
  signaturePng?: Buffer;
};
export function bindApplicantValues<T extends Record<string, unknown>>(
  values: T,
  bindings: ApplicantBindings | undefined,
  profile: ApplicantProfile | null,
  prefix = "",
): T {
  if (!bindings || !profile) return values;
  const result = { ...values },
    variables = applicantVariables(profile);
  for (const [target, source] of Object.entries(bindings.fields)) {
    check(target.startsWith(prefix), "Ungültiges Profil-Bindungsziel");
    const key = target.slice(prefix.length);
    check(
      /^[A-Za-z][A-Za-z0-9_-]*$/.test(key) &&
        !["constructor", "prototype", "__proto__"].includes(key),
      "Ungültiges Profil-Bindungsziel",
    );
    (result as Record<string, unknown>)[key] = variables[source];
  }
  return result;
}
export function bindApplicantCv(
  data: CvData,
  bindings: ApplicantBindings | undefined,
  profile: ApplicantProfile | null,
): CvData {
  return {
    ...data,
    person: bindApplicantValues(data.person, bindings, profile, "person."),
  };
}
export function bindApplicantForm(
  values: Values,
  bindings: ApplicantBindings | undefined,
  profile: ApplicantProfile | null,
): Values {
  return bindApplicantValues(values, bindings, profile);
}
export function bindApplicantCover(
  fields: CoverLetter,
  bindings: ApplicantBindings | undefined,
  profile: ApplicantProfile | null,
): CoverLetter {
  return bindApplicantValues(fields, bindings, profile);
}
export function applicantBuildFiles(
  bindings: ApplicantBindings | undefined,
  context: ApplicantRenderContext | undefined,
): Record<string, Buffer> {
  if (!bindings) return {};
  check(context, "Für diese Vorlage zuerst das Bewerberprofil übernehmen", 409);
  const variables = applicantVariables(context.profile);
  const signature =
    bindings.signature !== "none" ? context.signaturePng : undefined;
  check(
    bindings.signature !== "required" || signature,
    "Diese Vorlage benötigt eine Unterschrift. Im Bewerberprofil hochladen oder erstellen und für diese Bewerbung übernehmen.",
    409,
  );
  const signaturePath = signature ? "applicant-signature.png" : "";
  const tex = Object.entries(variables).map(([key, text]) => {
    const name =
      key === "addressLine2"
        ? "AddressLineTwo"
        : key[0]!.toUpperCase() + key.slice(1);
    return `\\long\\def\\Applicant${name}{${text.split("\n").map(escapeCoverText).join("\\\\")}}`;
  });
  tex.push(`\\def\\ApplicantSignaturePath{${signaturePath}}`);
  tex.push(`\\let\\ifApplicantHasSignature\\if${signature ? "true" : "false"}`);
  tex.push(
    `\\def\\ApplicantSignature{${signature ? "\\includegraphics[width=45mm,height=16mm,keepaspectratio]{applicant-signature.png}" : ""}}`,
  );
  return {
    "applicant-data.tex": Buffer.from(tex.join("\n") + "\n"),
    "applicant-data.lua": Buffer.from(
      "return " +
        luaData({
          ...variables,
          signaturePath,
          hasSignature: Boolean(signature),
        }) +
        "\n",
    ),
    ...(signature ? { "applicant-signature.png": signature } : {}),
  };
}
export function assertApplicantFieldsUnchanged(
  values: Record<string, unknown>,
  effective: Record<string, unknown>,
  bindings: ApplicantBindings | undefined,
  prefix = "",
) {
  for (const target of Object.keys(bindings?.fields || {})) {
    const key = target.slice(prefix.length);
    check(
      values[key] === effective[key],
      "Persönliche Daten im Bewerberprofil ändern und anschließend bewusst übernehmen.",
      409,
    );
  }
}
export function preserveApplicantSourceFields<
  T extends Record<string, unknown>,
>(
  values: T,
  original: T,
  bindings: ApplicantBindings | undefined,
  prefix = "",
): T {
  const result = { ...values };
  for (const target of Object.keys(bindings?.fields || {})) {
    const key = target.slice(prefix.length);
    if (Object.hasOwn(original, key))
      (result as Record<string, unknown>)[key] = original[key];
    else delete result[key];
  }
  return result;
}
