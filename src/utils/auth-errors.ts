/**
 * Maps Supabase Auth error messages or codes to user-friendly display strings.
 */
export const mapAuthError = (error: any): string => {
  if (!error) return "An unknown error occurred.";
  
  const message = typeof error === 'string' ? error : error.message || "";
  const code = error.code || "";

  // Common Supabase/GoTrue error codes and messages
  if (code === 'weak_password' || message.toLowerCase().includes("weak")) {
    return "Your password is too weak. Please use at least 8 characters with a mix of uppercase, numbers, and symbols.";
  }
  
  if (code === 'user_already_exists' || message.toLowerCase().includes("already registered")) {
    return "This email is already registered. Please try logging in or reset your password.";
  }

  if (code === 'over_email_send_rate_limit' || message.toLowerCase().includes("rate limit")) {
    return "Too many requests. Please wait a few minutes before trying again.";
  }

  if (message.toLowerCase().includes("invalid email")) {
    return "Please enter a valid email address.";
  }

  if (message.toLowerCase().includes("database error")) {
    return "A temporary database error occurred. Please try again in a few moments.";
  }

  // Fallback to the original message if it's somewhat descriptive, otherwise generic
  return message.length > 5 ? message : "Signup failed. Please check your information and try again.";
};
