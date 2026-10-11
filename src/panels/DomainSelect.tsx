import type { Domain } from "../model/model";

// The domain <select> shared by the modal (PropertiesDialog) and docked
// (SidePanel) inspectors so both bind domains identically (Slice 1). Presentational
// only: the caller supplies the domain list and binds via the store's
// bindFieldDomain. `null` means "detach" (free type).
export function DomainSelect({
  domains,
  value,
  onChange,
}: {
  domains: Domain[];
  value: string | undefined;
  onChange: (domainId: string | null) => void;
}) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— none (free type) —</option>
      {domains.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}
