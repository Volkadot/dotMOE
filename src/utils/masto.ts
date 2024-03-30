/**
 * A module to communicate with Mastodon.
 * "TOKEN" should be added to (.)env with the Mastodon token value.
 * 
 * @file
 * @author AozoraDev
 * @todo Due to Bun's lack of compatibility with masto.js regarding Blob,
 *       the temporary solution used was to write the file to temp dir and then create Blob from the file.
 */

import { createRestAPIClient, type mastodon } from "masto";
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sizeOf from "image-size";

import type { Post } from "types";

// Mastodon client
const client = createRestAPIClient({
    url: "https://sakurajima.moe",
    accessToken: Bun.env["TOKEN"]
});

/** Post visibility for Mastodon posts. Can be "public", "private", "direct", or "unlisted". */
const visibility = Bun.env["VISIBILITY"] as (mastodon.v1.StatusVisibility | undefined) || "public";

/**
 * Upload images to the Mastodon instance.
 * 
 * @param urls - An array containing the url to the file. Local file not supported rn.
 * @returns An array containing the IDs of attachments that have been uploaded. Can be empty if all images fetching are failed.
 */
export async function uploadImages(urls: string[]) {
    /** All uploaded images IDs */
    const attachments: string[] = [];
    /** Temp directory for saving the image(s) */
    const tempdir = await mkdtemp(path.join(tmpdir(), "dotmoe-"))
        .catch(console.error) as (string | undefined);

    // Return the empty attachments if tempdir is failed to be generated
    if (!tempdir) return attachments;
    
    for (const url of urls) {
        // Fetch Image file from attachment url
        const tempFile = path.join(tempdir, `image-${attachments.length}`);

        console.log(`Fetching ${url}...`);
        const img = await fetch(url)
            .then(res => res.arrayBuffer())
            .catch(console.error) as (ArrayBuffer | undefined);
        
        // Skip current if fetching Blob is failed or temp folder is failed to be created.
        if (!img) {
            console.warn(`Fetching attachment failed for url "${url}". Skipping...`);
            continue;
        }

        // Save the image to temp folder
        await Bun.write(tempFile, img);
        // Optimize the image
        await optimizeImage(tempFile);

        // And then upload it
        console.log("Uploading image to Mastodon instance...");
        await client.v2.media.create({
            /** @todo Error need to be ignored since Blob in Bun and Node is different */
            // @ts-ignore
            file: new Blob([Bun.file(tempFile + ".webp")])
        }).then(res => {
            console.log("Image uploaded with ID: " + res.id);
            attachments.push(res.id);
        }).catch(console.error);
    }

    // Delete the temp dir
    await rm(tempdir, { recursive: true, force: true })

    return attachments;
}

/**
 * Publish post to the Mastodon account
 * 
 * @param post - A post object
 * @returns Status object of the uploaded post
 * @throws {Error} The post failed to upload or the saved post has no attachments
 */
export async function publishPost(post: Post) {
    const attachments = await uploadImages(post.attachments.split("|"));
    if (!attachments.length) throw new Error("The post has no attachments.");

    let caption = post.message;
    caption += "\n\n"; // 2 Newline
    caption += `Posted by: [${post.author}](${post.author_link})`;    
    caption += "\n\n"; // 2 Newline
    caption += "#cute #moe #anime #artwork #mastoart #dotmoe";

    try {
        console.log("Publishing post....");
        const status = await client.v1.statuses.create({
            status: caption,
            visibility: visibility,
            mediaIds: attachments
        });

        return status;
    } catch (err) {
        throw err;
    }
}

/**
 * Optimize an image to webp to reduce file size.
 * After the process is complete, the image file will be saved in the same path with ".webp" added to the file name.
 * 
 * @param imagePath - Path to the image file
 */
async function optimizeImage(imagePath: string) {
    // Check if "cwebp" command exist. If not exist, don't optimize the image
    if (!Bun.which("cwebp")) return console.warn("\"cwebp\" command not found. Optimizing process is skipped.");

    const filename = path.basename(imagePath);
    console.log(`Optimizing "${filename}"...`);

    /** Check if the image is too oversize for Mastodon too handle */
    const isImageOversize = (sizeOf(imagePath).width as number) > 3840;
    if (isImageOversize) console.log(`"${filename} is oversize! Will reduce the image size too."`);

    // Convert the image to webp (and reduce the image size if possible)
    const options = [
        "-q 80",
        `-o "${imagePath}.webp"`
    ];
    if (isImageOversize) options.push("-resize 2000 0");

    const { exitCode } = await $`cwebp "${imagePath}" ${{raw: options.join(" ")}}`;
    if (exitCode === 0) {
        console.log(`Optimizing "${filename}" successfully!`);
    } else {
        console.error(`Optimizing "${filename}" failed! Will use original image instead.`);
    }
}