import type {
  ApplicantProfile,
  ApplicantVariables,
} from "../../shared/applicant-profile.ts";
import { emptyApplicantProfile } from "../../shared/applicant-profile.ts";
import type { ApplicantRenderContext } from "../applicant-rendering.ts";
import type { ImportManifest } from "./model.ts";
import { normalizeSignaturePng } from "../signature-image.ts";

export const syntheticApplicant: ApplicantProfile = {
  firstName: "Demo",
  lastName: "Applicant",
  street: "ProfileStreet107",
  addressLine2: "ProfileExtra109",
  postalCode: "12345",
  city: "ProfileCity113",
  country: "ProfileCountry127",
  signatureId: null,
};
export const syntheticApplicantExpected: ApplicantVariables = {
  firstName: "Demo",
  lastName: "Applicant",
  street: "ProfileStreet107",
  addressLine2: "ProfileExtra109",
  postalCode: "12345",
  city: "ProfileCity113",
  country: "ProfileCountry127",
  name: "Demo Applicant",
  address:
    "ProfileStreet107\nProfileExtra109\n12345 ProfileCity113\nProfileCountry127",
  sender:
    "Demo Applicant\nProfileStreet107\nProfileExtra109\n12345 ProfileCity113\nProfileCountry127",
};
export const secondSyntheticApplicant: ApplicantProfile = {
  firstName: "ChangedFirst197",
  lastName: "ChangedLast199",
  street: "ChangedStreet211",
  addressLine2: "ChangedExtra223",
  postalCode: "98765",
  city: "ChangedCity227",
  country: "ChangedCountry229",
  signatureId: null,
};
export const secondSyntheticApplicantExpected: ApplicantVariables = {
  firstName: "ChangedFirst197",
  lastName: "ChangedLast199",
  street: "ChangedStreet211",
  addressLine2: "ChangedExtra223",
  postalCode: "98765",
  city: "ChangedCity227",
  country: "ChangedCountry229",
  name: "ChangedFirst197 ChangedLast199",
  address:
    "ChangedStreet211\nChangedExtra223\n98765 ChangedCity227\nChangedCountry229",
  sender:
    "ChangedFirst197 ChangedLast199\nChangedStreet211\nChangedExtra223\n98765 ChangedCity227\nChangedCountry229",
};
// A synthetic color marker, not a person's handwritten signature.
export const syntheticSignature = normalizeSignaturePng(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAKnRFWHRDb21tZW50AHN5bnRoZXRpYyBtZXRhZGF0YSBtdXN0IGJlIHJlbW92ZWSEedAOAAAAGklEQVR4nGPgEpH7DwIMEHDiBJD4f+LEif8AhRwLHqGBKjkAAAAASUVORK5CYII=",
    "base64",
  ),
).png;
export const secondSyntheticSignature = normalizeSignaturePng(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAHElEQVR4nGO4JC/4//9/OQ0jBp4t8QEad9g5OAFUQwcDRE6THAAAAABJRU5ErkJggg==",
    "base64",
  ),
).png;
export function syntheticApplicantContext(
  profile = syntheticApplicant,
  signaturePng = syntheticSignature,
): ApplicantRenderContext {
  return { profile, signaturePng };
}
export function verificationApplicant(
  config: ImportManifest,
  data: unknown,
): ApplicantRenderContext | undefined {
  if (!config.applicant) return undefined;
  if (config.format === "bewerbung-cover-mod-v1") {
    const sender = String((data as { sender: string }).sender).split("\n");
    return syntheticApplicantContext({
      ...emptyApplicantProfile(),
      firstName: sender[0] || "",
      street: sender[1] || "",
    });
  }
  return syntheticApplicantContext();
}
