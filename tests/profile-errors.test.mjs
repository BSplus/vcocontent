import test from "node:test";
import assert from "node:assert/strict";
import { mapProfileError, isUsernameConflict } from "../server/profile-errors.ts";
import { MediaLimitError } from "../server/media-policy.ts";
import { readProfileFailure } from "../client/src/lib/profile-errors.ts";
test("only proven username constraints, including wrapped causes, are conflicts", () => {
  const cause = {code:"23505",constraint:"users_username_unique",table:"users",detail:"secret"};
  assert.equal(isUsernameConflict({cause:{cause}}),true);
  for (const error of [{code:"23505",constraint:"users_email_unique"},new Error("duplicate username"),{code:"23505"}, {code:"23505",constraint:"users_username_unique",table:"private"}]) {
    assert.equal(mapProfileError(error).status,500);
    assert.equal(mapProfileError(error).body.code,"server");
  }
  const cycle = {}; cycle.cause=cycle; assert.equal(isUsernameConflict(cycle),false);
  assert.deepEqual(mapProfileError({cause}).body.fieldErrors,{username:"This username is already taken. Choose another username."});
  for (const code of ["storage_full","storage_unknown","storage_cleanup","permission"]) assert.equal(mapProfileError(new MediaLimitError("private",code)).body.code,code);
});
test("the editor ignores untrusted raw errors and unknown field messages", () => {
  assert.equal(readProfileFailure(500,{error:"SQL secret"}).message.includes("secret"),false);
  assert.deepEqual(readProfileFailure(400,{code:"validation",fieldErrors:{bio:"provider secret"}}).fields,{});
  for (const [status,expected] of [[401,/Sign in/],[403,/access/],[429,/Wait/],[413,/3 MB/],[502,/server/]]) assert.match(readProfileFailure(status,"<html>private</html>").message,expected);
});
