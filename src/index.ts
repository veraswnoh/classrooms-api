import { Hono } from "hono";
import { cors } from "hono/cors";
import auth, { verifyTokenFromCookie } from "./routes/auth";
import courses from "./routes/courses";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "http://localhost:5173",
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "Access-Control-Allow-Origin",
      "Access-Control-Allow-Credentials",
      "X-Custom-Header",
      "Upgrade-Insecure-Requests",
    ],
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
    exposeHeaders: ["Content-Type", "Authorization", "Credentials"],
    maxAge: 86400,
    credentials: true,
  })
);

// Use the auth routes without bearerAuth middleware
app.route("/auth", auth);

app.use("/*", verifyTokenFromCookie);

app.get("/protected", (c) => {
  return c.json({
    message: "You are authenticated!",
  });
});

app.route("/courses", courses);

app.get("/", (c) => {
  return c.text("Hello World!");
});

export default app;
