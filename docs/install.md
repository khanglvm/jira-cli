# Install

Install jira-cli from npm, then save a profile that holds your Jira address and login. It needs Node.js 18.17 or newer and an account on a Jira Server.

```sh
npm install -g @khanglvm/jira-cli
jira-cli --version
```

## Connect to Jira

Put your Jira username and password in environment variables, then add a profile. Replace the example address with your own Jira URL.

```sh
export JIRA_USERNAME=your-username
export JIRA_PASSWORD=your-password

jira-cli profile add work \
  --base-url https://jira.example.com \
  --username "$JIRA_USERNAME" \
  --password "$JIRA_PASSWORD" \
  --default
```

`profile add` saves the profile to `~/.config/jira-cli/config.json` and puts the password in your OS keychain, so the config file holds no secret. Keep credentials out of source files and chat messages.

Check that the login works:

```sh
jira-cli profile test
```

It prints the Jira user you signed in as. `jira-cli profile list` shows every saved profile, with the password hidden.

If the keychain is not available, for example on a headless server, see [Profiles and storage](profiles.md) for the fallback modes.

## Next steps

Run your first commands in the [Quickstart](quickstart.md).
