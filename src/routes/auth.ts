import { Hono, Context } from "hono";
import prisma from "../utils/db";
import { sign } from "hono/jwt";
import { z } from "zod";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Role } from "@prisma/client";
import { verify } from "hono/jwt";

const app = new Hono();

interface CustomContext extends Context {
  set(key: "authUser", value: any): void;
  get(key: "authUser"): any;
  // Add other methods and properties as needed
}

const credentialsSchema = z.object({
  username: z.string().min(1, "Username is required."),
  password: z.string().min(1, "Password is required."),
});

const accountCreationSchema = z.object({
  password: z
    .string({ required_error: "Password is required." })
    .min(8, "Password needs to be at least 8 characters.")
    .refine((val) => /[A-Z]/.test(val), {
      message: "Password must contain at least one uppercase letter.",
    })
    .refine((val) => /[a-z]/.test(val), {
      message: "Password must contain at least one lowercase letter.",
    })
    .refine((val) => /[0-9]/.test(val), {
      message: "Password must contain at least one number.",
    })
    .refine((val) => /[!@#$%^&*(),.?":{}|<>]/.test(val), {
      message: "Password must contain at least one special character.",
    }),
  first_name: z
    .string({ required_error: "First name is required." })
    .min(3, "First name needs to be at least 3 characters."),
  last_name: z
    .string({ required_error: "Last name is required." })
    .min(2, "Last name needs to be at least 2 characters."),
  role: z
    .string({ required_error: "Role is required." })
    .transform((val) => val.toUpperCase() as Role)
    .refine((val) => Object.values(Role).includes(val as Role), {
      message: "Invalid role value.",
    }),
});

const updatePasswordSchema = z.object({
  password: z.string().min(1, "Password is required."),
  new_password: z
    .string({ required_error: "Password is required." })
    .min(8, "Password needs to be at least 8 characters.")
    .refine((val) => /[A-Z]/.test(val), {
      message: "Password must contain at least one uppercase letter.",
    })
    .refine((val) => /[a-z]/.test(val), {
      message: "Password must contain at least one lowercase letter.",
    })
    .refine((val) => /[0-9]/.test(val), {
      message: "Password must contain at least one number.",
    })
    .refine((val) => /[!@#$%^&*(),.?":{}|<>]/.test(val), {
      message: "Password must contain at least one special character.",
    }),
});

// Custom middleware to verify token from cookie
export const verifyTokenFromCookie = async (
  c: CustomContext,
  next: () => Promise<void>
) => {
  const token = getCookie(c, "token");

  if (!token) {
    return c.json({ message: "You need to be logged in to do that." }, 401);
  }

  try {
    const payload = await verify(token, Bun.env.AUTH_SECRET || "missingsecret");
    const user = await prisma.account.findFirst({
      where: { username: (payload as { username: string }).username },
      select: { username: true, role: true, first_name: true, last_name: true },
    });

    if (!user) {
      return c.json({ message: "Could not find your session." }, 401);
    }

    // Attach user to context
    c.set("authUser", user);
    await next();
  } catch (e) {
    return c.json({ message: "Unauthorized" }, 401);
  }
};

const checkRole = async (c: CustomContext, next: () => Promise<void>) => {
  try {
    const user = c.get("authUser");

    if (user.role === Role.STUDENT) {
      return c.json(
        { message: "You are unauthorized to create an account." },
        401
      );
    }

    // Attach user to context
    c.set("authUser", user);
    await next();
  } catch (e) {
    return c.json({ message: "Unauthorized." }, 401);
  }
};

export const checkAuthCredentials = async (
  username: string,
  password: string
) => {
  const user = await prisma.account.findFirst({
    where: {
      username,
    },
  });

  if (!user) {
    throw new Error("Could not find username.");
  }

  if (user.password !== password) {
    throw new Error("Incorrect password.");
  }

  const payload = {
    username,
    exp: Math.floor(Date.now() / 1000) + 60 * 60, // Token expires in 60minutes
  };

  const token = await sign(payload, Bun.env.AUTH_SECRET || "missingsecret");

  return {
    payload,
    token,
  };
};

export const createAccount = async (
  password: string,
  first_name: string,
  last_name: string,
  role: Role
) => {
  const uniqueUsername = await checkAndCreateUsername(first_name, last_name);

  try {
    await prisma.account.create({
      data: {
        username: uniqueUsername,
        password: password,
        first_name: first_name,
        last_name: last_name,
        role: role,
      },
    });
  } catch (e) {
    throw new Error("An error occurred while creating the account.");
  }

  return uniqueUsername;
};

const checkAndCreateUsername = async (
  first_name: string,
  last_name: string
) => {
  let username = `${first_name
    .toLowerCase()
    .charAt(0)}${last_name.toLowerCase()}`;

  let user = await prisma.account.findFirst({
    where: {
      username,
    },
  });

  while (user) {
    // Check if username contains numbers
    if (/\d/.test(username)) {
      // Use regex to extract the digits as number
      const match = username.match(/\d+/);
      const digits = match ? parseInt(match[0]) : 0;

      // Use regex to extract only the letters
      const letters = username.match(/[a-z]/g)?.join("");

      username = letters + (digits + 1).toString();
    } else {
      username += "1";
    }

    user = await prisma.account.findFirst({
      where: {
        username,
      },
    });
  }
  return username;
};

app.post("/login", async (c) => {
  const validated_credentials = await credentialsSchema.safeParseAsync(
    await c.req.json()
  );

  if (!validated_credentials.success) {
    return c.json(
      {
        message: validated_credentials.error.issues
          .map((issue) => {
            return issue.message;
          })
          .join(" "),
      },
      400
    );
  }

  const { username, password } = validated_credentials.data;

  try {
    const { token } = await checkAuthCredentials(username, password);

    setCookie(c, "token", token, {
      maxAge: 86400,
    });

    return c.json({
      message: "Logged in successfully!",
    });
  } catch (e) {
    return c.json<{ message: string }>(
      {
        message: e instanceof Error ? e.message : "Unknown error occurred.",
      },
      401
    );
  }
});

// Protect the create_account route with bearerAuth and role check
app.post("/create_account", verifyTokenFromCookie, checkRole, async (c) => {
  const validated_credentials = await accountCreationSchema.safeParseAsync(
    await c.req.json()
  );

  if (!validated_credentials.success) {
    return c.json(
      {
        message: validated_credentials.error.issues
          .map((issue) => {
            return issue.message;
          })
          .join(" "),
      },
      400
    );
  }

  const { first_name, last_name, password, role } = validated_credentials.data;

  try {
    const username = await createAccount(
      password,
      first_name,
      last_name,
      role as Role
    );

    return c.json({
      message: `Account created successfully with username: ${username}`,
    });
  } catch (e) {
    return c.json(
      {
        message: e instanceof Error ? e.message : "Unknown error occurred.",
      },
      401
    );
  }
});

app.get("/me", verifyTokenFromCookie, async (c: CustomContext) => {
  try {
    const user = c.get("authUser");

    return c.json(user, 200);
  } catch (e) {
    return c.json<{ message: string }>(
      {
        message: e instanceof Error ? e.message : "Unknown error occurred.",
      },
      401
    );
  }
});

app.get("/logout", async (c) => {
  try {
    deleteCookie(c, "token");

    return c.json({
      message: "Logged out successfully!",
    });
  } catch (e) {
    return c.json<{ message: string }>(
      {
        message: e instanceof Error ? e.message : "Unknown error occurred.",
      },
      401
    );
  }
});

app.put("/update_password", verifyTokenFromCookie, async (c: CustomContext) => {
  try {
    const user = c.get("authUser");

    const parsed = await updatePasswordSchema.safeParseAsync(
      await c.req.json()
    );

    if (!parsed.success) {
      return c.json(
        {
          message: parsed.error.issues
            .map((issue) => {
              return issue.message;
            })
            .join(" "),
        },
        400
      );
    }

    const { password, new_password } = parsed.data;

    if (password === new_password) {
      return c.json(
        {
          message: "New password cannot be the same as your current password.",
        },
        400
      );
    }

    const accountPassword = await prisma.account.findFirst({
      where: {
        username: user.username,
      },
      select: {
        password: true,
      },
    });

    if (password !== accountPassword?.password) {
      return c.json(
        {
          message: "Incorrect password.",
        },
        401
      );
    }

    await prisma.account.update({
      where: {
        username: user.username,
      },
      data: {
        password: new_password,
      },
    });

    return c.json(
      {
        message: "Password updated successfully!",
      },
      200
    );
  } catch (e) {
    return c.json<{ message: string }>(
      {
        message: e instanceof Error ? e.message : "Unknown error occurred.",
      },
      401
    );
  }
});

export default app;
