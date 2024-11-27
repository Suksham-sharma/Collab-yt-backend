import { Router, Request, Response } from "express";
import prismaClient from "../lib/prismaClient";
import { updateVideoTimeData, uploadVideoData } from "../schemas";
import { redisManager } from "../lib/redisManager";
import { upload } from "../lib/multer";

export const videosRouter = Router();

videosRouter.get("/feed", async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const whereClause: any = {};
    if (req.query.category) {
      whereClause.category = {
        contains: req.query.category as string,
      };
    }

    const totalVideos = await prismaClient.video.count({
      where: whereClause,
    });

    const videos = await prismaClient.video.findMany({
      skip: +page === 1 ? 0 : (+page - 1) * +limit,
      take: +limit,
      where: whereClause,
      include: {
        creator: {
          select: {
            username: true,
            id: true,
          },
        },
      },
    });

    const totalPages = Math.ceil(totalVideos / +limit);

    res.status(200).json({
      videos,
      totalPages,
      currentPage: +page,
    });
  } catch (error: any) {}
});

videosRouter.put("/:video_id/time", async (req: Request, res: Response) => {
  const { video_id } = req.params;

  console.log("video_id", video_id);

  try {
    console.log("req.body", req.body);
    const updateTimeStampPayload = updateVideoTimeData.safeParse(req.body);

    if (!updateTimeStampPayload.success) {
      res.status(408).json({
        error: updateTimeStampPayload.error.errors.map(
          (error) => error.message
        ),
      });
      return;
    }

    const { timestamp } = updateTimeStampPayload.data;
    const video = await prismaClient.video.findUnique({
      where: { id: video_id },
    });

    if (!video) {
      res.status(404).json({ error: "Video not found." });
      return;
    }

    const videoDuration = video.duration;
    // if (timestamp > videoDuration) {
    //   res.status(400).json({
    //     error: `Timestamp cannot exceed video duration of ${videoDuration} seconds.`,
    //   });
    //   return;
    // }

    const stringTimestamp = timestamp.toString();

    await prismaClient.video.update({
      where: { id: video_id },
      data: { timeStamp: stringTimestamp },
    });

    res.status(201).json({ message: "Timestamp updated successfully." });

    redisManager.sendUpdatesToWs({
      action: "update-time",
      videoId: video_id,
      timestamp,
    });
  } catch (error: any) {
    console.error("Error updating video timestamp:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

videosRouter.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response) => {
    console.log("hertdd");
    try {
      console.log(req.body);
      const videoUploadPayload = uploadVideoData.safeParse(req.body);

      if (!videoUploadPayload.success) {
        res.status(400).json({
          error: videoUploadPayload.error.errors.map((error) => error.message),
        });
        return;
      }

      const { title, description, category, file } = videoUploadPayload.data;

      if (!req.userId) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }

      const findChannel = await prismaClient.channel.findUnique({
        where: { creatorId: req.userId },
      });

      if (!findChannel) {
        res.status(404).json({ error: "Channel not found." });
        return;
      }

      const video = await prismaClient.video.create({
        data: {
          title,
          description,
          category,
          creatorId: req.userId,
          channelId: findChannel.id,
          video_urls: {
            "240p": `https://example.com/${file}240p`,
            "480p": `https://example.com/${file}480p`,
            "720p": `https://example.com/${file}720p`,
          },
        },
      });

      redisManager.sendUpdatesToWs({
        action: "new-add",
        videoId: video.id,
      });

      res.status(200).json({ ...video, processing_status: "PROCESSING" });
    } catch (error: any) {
      console.error("Error uploading video:", error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

videosRouter.get("/:video_id", async (req: Request, res: Response) => {
  try {
    const { video_id } = req.params;

    const video = await prismaClient.video.findUnique({
      where: { id: video_id },
      include: {
        creator: {
          select: {
            username: true,
            id: true,
          },
        },
      },
    });

    if (!video) {
      res.status(404).json({ error: "Video not found." });
      return;
    }

    video.video_urls = {
      "240p": "<https://example.com/video_240p.mp4>",
      "480p": "<https://example.com/video_480p.mp4>",
      "720p": "<https://example.com/video_720p.mp4>",
    };

    res.status(200).json({ ...video, status: "TRANSCODED" });
  } catch (error: any) {
    console.log("Error fetching video:", error);
  }
});