export function formatAssignmentTitle(title: string | null | undefined): string {
  if (!title) return '';
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(title);
  if (!match) return title;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
}