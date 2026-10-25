import * as dotenv from "dotenv";
import { DatabaseSync } from "node:sqlite";
import { AccountRow, renameAccount } from "./Accounts";
import {
  adminDeleteAccount,
  banAccount,
  bannedAccounts,
  describeAccount,
  findAccount,
  roundAccounts,
  searchAccounts,
  signOutEverywhere,
  unbanAccount,
} from "./Admin";
import { apiConfigFromEnv } from "./Config";
import { openDatabase } from "./Db";

// Under a Dark Star: the moderation command (docs/DarkStar-Accounts.md A18,
// §10, B6). Run it where the API runs, with the API's environment: on the
// server, inside the game container (the exact command is in the private
// operations doc). Safe while the API is up: each change is one statement
// on the same SQLite file.

const USAGE = `Moderation commands (an account is its id, its board name Name.1234, or a name):

  find <account>                          show one account
  search <text>                           accounts whose name contains the text
  game <game id>                          signed-in players of a recorded throne round
  banned                                  every ban in force
  ban <account> [--days N] [--reason "why"]   ban (permanent without --days)
  unban <account>                         lift a ban
  rename <account> <new name>             change the name (keeps the four digits)
  signout <account>                       end every session of the account
  delete <account> --yes                  delete the account for good (A17)`;

dotenv.config();

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help") {
    console.info(USAGE);
    return 0;
  }
  const config = apiConfigFromEnv();
  const db = openDatabase(config.dataDir);
  try {
    return run(db, command, rest, Date.now());
  } finally {
    db.close();
  }
}

function run(
  db: DatabaseSync,
  command: string,
  args: string[],
  now: number,
): number {
  const { positional, flags } = parseArgs(args);
  const show = (account: AccountRow) =>
    console.info(describeAccount(account, now));

  switch (command) {
    case "search": {
      const found = searchAccounts(db, positional.join(" "));
      if (found.length === 0) console.info("No account matches.");
      found.forEach(show);
      return 0;
    }
    case "game": {
      const found = roundAccounts(db, positional[0] ?? "");
      if (found.length === 0) {
        console.info(
          "No signed-in player recorded for that game. Only public throne rounds are recorded, and guests never are.",
        );
      }
      found.forEach(show);
      return 0;
    }
    case "banned": {
      const found = bannedAccounts(db, now);
      if (found.length === 0) console.info("No ban in force.");
      found.forEach(show);
      return 0;
    }
  }

  const account = resolve(db, positional[0]);
  if (account === null) return 1;

  switch (command) {
    case "find":
      show(account);
      return 0;
    case "ban": {
      const days = flags.days === undefined ? undefined : Number(flags.days);
      if (days !== undefined && !(Number.isFinite(days) && days > 0)) {
        console.error("--days needs a number above zero.");
        return 1;
      }
      banAccount(db, account.id, { reason: flags.reason, days }, now);
      console.info(
        "Banned. Takes hold within 15 minutes, at the player's next sign-in refresh.",
      );
      show(refetch(db, account));
      return 0;
    }
    case "unban":
      unbanAccount(db, account.id);
      console.info("Ban lifted.");
      show(refetch(db, account));
      return 0;
    case "rename": {
      const name = positional.slice(1).join(" ");
      if (renameAccount(db, account.id, name, now) === "invalid") {
        console.error(
          "Not a valid account name: 3 to 20 letters, digits, _ or -, single spaces between words.",
        );
        return 1;
      }
      console.info("Renamed.");
      show(refetch(db, account));
      return 0;
    }
    case "signout": {
      const ended = signOutEverywhere(db, account.id, now);
      console.info(`Ended ${ended} session(s).`);
      return 0;
    }
    case "delete":
      if (flags.yes === undefined) {
        console.error(
          `This erases ${describeAccount(account, now)} for good. Run it again with --yes.`,
        );
        return 1;
      }
      adminDeleteAccount(db, account.id, now);
      console.info("Deleted.");
      return 0;
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      return 1;
  }
}

function resolve(
  db: DatabaseSync,
  query: string | undefined,
): AccountRow | null {
  if (query === undefined || query === "") {
    console.error(`Name an account.\n\n${USAGE}`);
    return null;
  }
  const found = findAccount(db, query);
  if (found.kind === "found") return found.account;
  if (found.kind === "none") {
    console.error(`No account "${query}". Try: search ${query}`);
    return null;
  }
  console.error(
    `Several accounts are called "${query}"; use the id or Name.1234:`,
  );
  for (const account of found.accounts) {
    console.error(`  ${describeAccount(account, Date.now())}`);
  }
  return null;
}

function refetch(db: DatabaseSync, account: AccountRow): AccountRow {
  return (
    (db
      .prepare("SELECT * FROM accounts WHERE id = ?")
      .get(account.id) as unknown as AccountRow | undefined) ?? account
  );
}

// `--days 7`, `--reason "spam"`, `--yes`; everything else is positional.
function parseArgs(args: string[]): {
  positional: string[];
  flags: Record<string, string | undefined> & { yes?: string };
} {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--yes") {
      flags.yes = "true";
    } else if (arg.startsWith("--")) {
      flags[arg.slice(2)] = args[i + 1] ?? "";
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

process.exitCode = main(process.argv.slice(2));
