/**
 * Calculates age based on a date of birth string.
 * @param dobString - Date of birth string in YYYY-MM-DD or ISO format.
 * @returns The calculated age in years, or undefined if the date is invalid.
 */
export const calculateAge = (dobString: string | null | undefined): number | undefined => {
  if (!dobString) return undefined;
  
  const parts = dobString.split(/[-T/]/);
  if (parts.length < 3) return undefined;
  
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1; // Month is 0-indexed
  const day = parseInt(parts[2]);
  
  const birthDate = new Date(year, month, day);
  if (isNaN(birthDate.getTime())) return undefined;
  
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  // If the birth month is in the future this year, or if it's the birth month 
  // but the birth day is in the future, subtract one year from the age.
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age >= 0 ? age : 0;
};
