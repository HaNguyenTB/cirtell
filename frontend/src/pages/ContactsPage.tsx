import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Loader2, Mail, Pencil, Phone, Plus, Search, Trash2, UserRound, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

interface Contact {
  id: string;
  companyName: string;
  contactPersonName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  notes?: string | null;
}

interface ContactForm {
  companyName: string;
  contactPersonName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  notes: string;
}

const EMPTY_FORM: ContactForm = {
  companyName: '',
  contactPersonName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  country: '',
  notes: '',
};

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function ContactsPage() {
  const { user } = useAuthStore();
  const canEdit = user?.role === 'Admin' || user?.role === 'User' || user?.is_super_admin === true;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined);
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest<{ contacts: Contact[] }>('/api/contacts');
      setContacts(response.contacts || []);
    } catch (error) {
      setNotice({ type: 'error', text: message(error, 'Failed to load contacts') });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((contact) => [
      contact.companyName,
      contact.contactPersonName,
      contact.email,
      contact.phone,
      contact.city,
      contact.country,
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [contacts, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const openEdit = (contact: Contact) => {
    setEditing(contact);
    setForm({
      companyName: contact.companyName,
      contactPersonName: contact.contactPersonName || '',
      email: contact.email || '',
      phone: contact.phone || '',
      address: contact.address || '',
      city: contact.city || '',
      country: contact.country || '',
      notes: contact.notes || '',
    });
  };

  const closeModal = () => {
    setEditing(undefined);
    setForm(EMPTY_FORM);
  };

  const save = async () => {
    if (!form.companyName.trim()) {
      setNotice({ type: 'error', text: 'Company name is required' });
      return;
    }
    setSaving(true);
    try {
      await apiRequest(editing?.id ? `/api/contacts/${editing.id}` : '/api/contacts', {
        method: editing?.id ? 'PUT' : 'POST',
        body: form,
      });
      closeModal();
      setNotice({ type: 'success', text: editing?.id ? 'Contact updated' : 'Contact created' });
      await loadContacts();
    } catch (error) {
      setNotice({ type: 'error', text: message(error, 'Failed to save contact') });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (contact: Contact) => {
    if (!window.confirm(`Delete ${contact.companyName}?`)) return;
    try {
      await apiRequest(`/api/contacts/${contact.id}`, { method: 'DELETE' });
      setNotice({ type: 'success', text: 'Contact deleted' });
      await loadContacts();
    } catch (error) {
      setNotice({ type: 'error', text: message(error, 'Failed to delete contact') });
    }
  };

  return (
    <div className="space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-gray-900">Contacts</h1>
          <p className="mt-1 text-sm text-gray-500">Manage buyers and customer contacts used by transactions.</p>
        </div>
        {canEdit && (
          <button onClick={openCreate} className="flex items-center gap-2 rounded-apple bg-signal-teal px-4 py-2.5 text-sm font-medium text-white hover:bg-signal-teal/90">
            <Plus size={17} />
            Add Contact
          </button>
        )}
      </header>

      {notice && (
        <div className={`rounded-apple border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {notice.text}
        </div>
      )}

      <div className="flex items-center gap-3 border-y border-gray-200 py-4">
        <div className="relative max-w-xl flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search company, buyer, email, or phone..."
            className="input-base pl-10"
          />
        </div>
        <span className="text-sm text-gray-500">{filtered.length} contact{filtered.length === 1 ? '' : 's'}</span>
      </div>

      <div className="overflow-hidden rounded-apple border border-gray-200 bg-white">
        <table className="w-full text-left">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-5 py-3 font-medium">Company</th>
              <th className="px-5 py-3 font-medium">Buyer / Contact</th>
              <th className="px-5 py-3 font-medium">Contact details</th>
              <th className="px-5 py-3 font-medium">Location</th>
              <th className="w-28 px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-gray-500"><Loader2 className="mx-auto mb-2 animate-spin" size={20} />Loading contacts...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-gray-500">No contacts found.</td></tr>
            ) : filtered.map((contact) => (
              <tr key={contact.id} className="hover:bg-gray-50/70">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3"><Building2 size={17} className="text-signal-teal" /><span className="font-medium text-gray-900">{contact.companyName}</span></div>
                </td>
                <td className="px-5 py-4 text-sm text-gray-700">{contact.contactPersonName || '-'}</td>
                <td className="px-5 py-4 text-sm text-gray-600">
                  {contact.email && <div className="flex items-center gap-1.5"><Mail size={13} />{contact.email}</div>}
                  {contact.phone && <div className="mt-1 flex items-center gap-1.5"><Phone size={13} />{contact.phone}</div>}
                  {!contact.email && !contact.phone && '-'}
                </td>
                <td className="px-5 py-4 text-sm text-gray-600">{[contact.city, contact.country].filter(Boolean).join(', ') || '-'}</td>
                <td className="px-5 py-4">
                  {canEdit && <div className="flex gap-1">
                    <button onClick={() => openEdit(contact)} title="Edit contact" className="rounded-apple p-2 text-gray-500 hover:bg-gray-100 hover:text-signal-teal"><Pencil size={16} /></button>
                    <button onClick={() => void remove(contact)} title="Delete contact" className="rounded-apple p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== undefined && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/40" onClick={closeModal} aria-label="Close contact form" />
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-apple-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div className="flex items-center gap-2"><UserRound className="text-signal-teal" size={20} /><h2 className="text-lg font-semibold">{editing ? 'Edit Contact' : 'Add Contact'}</h2></div>
              <button onClick={closeModal} title="Close" className="rounded-apple p-2 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2">
              {[
                ['Company name', 'companyName', true],
                ['Contact person', 'contactPersonName', false],
                ['Email', 'email', false],
                ['Phone', 'phone', false],
                ['Address', 'address', false],
                ['City', 'city', false],
                ['Country', 'country', false],
              ].map(([label, key, required]) => (
                <label key={String(key)} className="text-sm text-gray-700">
                  <span className="mb-1 block font-medium">{label}{required ? ' *' : ''}</span>
                  <input
                    type={key === 'email' ? 'email' : 'text'}
                    value={form[key as keyof ContactForm]}
                    onChange={(event) => setForm((current) => ({ ...current, [String(key)]: event.target.value }))}
                    className="input-base"
                  />
                </label>
              ))}
              <label className="text-sm text-gray-700 md:col-span-2">
                <span className="mb-1 block font-medium">Notes</span>
                <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={3} className="input-base resize-y" />
              </label>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
              <button onClick={closeModal} className="rounded-apple px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={() => void save()} disabled={saving} className="flex items-center gap-2 rounded-apple bg-signal-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                {saving && <Loader2 className="animate-spin" size={16} />}
                {saving ? 'Saving...' : 'Save Contact'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
