export type ApplicantProfile = {
  firstName: string;
  lastName: string;
  street: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: string;
  signatureId: string | null;
};
export const applicantTextFields = [
  "firstName",
  "lastName",
  "street",
  "addressLine2",
  "postalCode",
  "city",
  "country",
] as const;
export type ApplicantVariables = Record<
  (typeof applicantTextFields)[number] | "name" | "address" | "sender",
  string
>;
export type ApplicantBindings = {
  fields: Record<string, keyof ApplicantVariables>;
  signature: "none" | "optional" | "required";
};
export function emptyApplicantProfile(legacyName = ""): ApplicantProfile {
  return {
    firstName: legacyName,
    lastName: "",
    street: "",
    addressLine2: "",
    postalCode: "",
    city: "",
    country: "",
    signatureId: null,
  };
}
export function applicantVariables(
  profile: ApplicantProfile,
): ApplicantVariables {
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const address = [
    profile.street,
    profile.addressLine2,
    [profile.postalCode, profile.city].filter(Boolean).join(" "),
    profile.country,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    ...Object.fromEntries(
      applicantTextFields.map((key) => [key, profile[key]]),
    ),
    name,
    address,
    sender: [name, address].filter(Boolean).join("\n"),
  } as ApplicantVariables;
}
export function sameApplicantProfile(
  a: ApplicantProfile,
  b: ApplicantProfile,
): boolean {
  return [...applicantTextFields, "signatureId" as const].every(
    (key) => a[key] === b[key],
  );
}
export function validateApplicantProfile(
  value: unknown,
): asserts value is ApplicantProfile {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Bewerberprofil erwartet");
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== 8 ||
    !Object.keys(data).every((key) =>
      [...applicantTextFields, "signatureId"].includes(key),
    )
  )
    throw Error("Unbekanntes oder fehlendes Profilfeld");
  for (const key of applicantTextFields) {
    const text = data[key];
    if (
      typeof text !== "string" ||
      text.length > 200 ||
      text !== text.trim() ||
      /[\x00-\x1f\x7f]/.test(text)
    )
      throw Error("Ungültiges Profilfeld: " + key);
  }
  if (applicantVariables(data as ApplicantProfile).name.length > 120)
    throw Error("Name maximal 120 Zeichen");
  if (
    data.signatureId !== null &&
    (typeof data.signatureId !== "string" ||
      !/^[a-f0-9]{64}$/.test(data.signatureId))
  )
    throw Error("Ungültige Unterschrift-ID");
}
export function validateApplicantBindings(
  value: unknown,
  targets: readonly string[],
): asserts value is ApplicantBindings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Profilbindungen erwartet");
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== 2 ||
    !Object.hasOwn(data, "fields") ||
    !Object.hasOwn(data, "signature") ||
    !["none", "optional", "required"].includes(String(data.signature))
  )
    throw Error("Ungültiger Profil-/Unterschriftsbedarf");
  if (
    !data.fields ||
    typeof data.fields !== "object" ||
    Array.isArray(data.fields) ||
    Object.keys(data.fields).length > 40
  )
    throw Error("Ungültige Profilfeldbindungen");
  const variables = Object.keys(applicantVariables(emptyApplicantProfile()));
  for (const [target, source] of Object.entries(data.fields)) {
    if (
      !targets.includes(target) ||
      typeof source !== "string" ||
      !variables.includes(source)
    )
      throw Error("Unbekannte Profilbindung: " + target);
  }
}
