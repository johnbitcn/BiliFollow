# BiliFollow

[简体中文](./README.zh-CN.md)

**A simpler way to tidy up your Bilibili Following list.**

Following too many accounts to manage them one by one? BiliFollow adds a manager to **your own Following page**. Find the accounts you want, select them, and make changes together.

## What can I do with it?

- **Find people faster.** Search by name, bio, or user ID. Show only ungrouped accounts, special follows, or accounts in one or more groups.
- **Organize your follows.** Add accounts to a group while keeping their current groups, or move them to a group instead.
- **Make changes in one go.** Add or remove special follows, unfollow selected accounts, or add them to your blocklist.
- **Stay in control.** Select people individually or select everyone in the current results. Review the list before anything changes.

## Get started

1. Install and enable [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open the [BiliFollow script](./bili-follow-manager.user.js) on GitHub and click **Raw**. Copy all of the text.
3. In Tampermonkey, choose **Create a new script**. Replace the starter text with what you copied, then save.
4. Sign in to Bilibili and open **your own Following (关注) page**. Refresh the page, then click **管理关注** (Manage follows) near the bottom right.

The manager follows the page language by default. If Bilibili is in Chinese, choose **English** from the language menu at the top of the manager. Your choice is saved.

## Use the manager

1. Search or choose the groups you want to see.
2. Tick individual accounts, or click **Select filtered results**. Your selections stay selected if you change the search or filters, so check the selected count before continuing.
3. Choose an action at the bottom of the panel. For group changes, choose the destination group too.
4. Check the names and action in the confirmation window, then confirm.

You can click **Stop** while an action is running. Changes already completed will remain; the script cannot undo them automatically. Unfollowing can also affect special or mutual follows, and adding someone to your blocklist may unfollow them.

## Need help?

- **No manager button?** Make sure Tampermonkey is enabled, you are signed in, and you are viewing your **own** Following page. Then refresh it.
- **The action stopped with `-352`?** Bilibili declined the request. Wait before trying again. Accounts already processed stay changed; accounts not yet processed remain selected.
- **Want to start over?** Click **Reload** to refresh the list. This also clears your selections and group filters.

Released under the [MIT License](./LICENSE).
