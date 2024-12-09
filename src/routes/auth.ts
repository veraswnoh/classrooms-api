import { Hono } from "hono";
import prisma from "../utils/db";
import { sign } from "hono/jwt";
import { z } from "zod";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Role } from "@prisma/client";
import { verify } from "hono/jwt";

const app = new Hono();

const credentialsSchema = z.object({
  username: z.string().min(1, "Username is required."),
  password: z.string().min(1, "Password is required."),
});

const accountCreationSchema = z.object({
  password: z.string().min(1, "Password is required."),
  first_name: z.string().min(1, "First name is required."),
  last_name: z.string().min(1, "Last name is required."),
  role: z
    .string({ required_error: "Role is required." })
    .transform((val) => val.toUpperCase() as Role)
    .refine((val) => Object.values(Role).includes(val as Role), {
      message: "Invalid role value.",
    }),
});

// Custom middleware to verify token from cookie
export const verifyTokenFromCookie = async (
  c: any,
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

const checkRole = async (c: any, next: () => Promise<void>) => {
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

app.get("/me", async (c) => {
  const token = getCookie(c, "token");

  if (!token) {
    return c.json(
      {
        message: "You are not signed in.",
      },
      401
    );
  }

  try {
    const payload = await verify(token, Bun.env.AUTH_SECRET || "missingsecret");

    const user = await prisma.account.findFirst({
      where: {
        username: (payload as { username: string }).username,
      },
      select: {
        first_name: true,
        last_name: true,
        username: true,
        role: true,
      },
    });

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

export default app;
