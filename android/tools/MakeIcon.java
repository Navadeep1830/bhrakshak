import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;

/**
 * Generates the BhuRakshak Field launcher icon (brand hexagon) at all
 * mipmap densities. Headless-safe: pure BufferedImage, no display.
 *
 * Usage:  java -Djava.awt.headless=true MakeIcon <android-project-dir>
 */
public class MakeIcon {

    static final Color BG = new Color(0x07, 0x0c, 0x14);
    static final Color EMERALD = new Color(0x10, 0xb9, 0x81);

    // 32-unit brand design (matches the web app logo)
    static final double[][] OUTER = {{16,2},{29,9},{29,23},{16,30},{3,23},{3,9}};
    static final double[][] INNER = {{16,7},{25,12},{25,20},{16,25},{7,20},{7,12}};
    static final double[][] PEAK  = {{16,11},{21,19.5},{11,19.5}};

    public static void main(String[] args) throws Exception {
        File root = new File(args.length > 0 ? args[0] : ".");
        int[] sizes = {
            48,    // mdpi
            72,    // hdpi
            96,    // xhdpi
            144,   // xxhdpi
            192,   // xxxhdpi
        };
        String[] dirs = {"mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"};
        for (int i = 0; i < dirs.length; i++) {
            int n = sizes[i];
            BufferedImage img = new BufferedImage(n, n, BufferedImage.TYPE_INT_ARGB);
            Graphics2D g = img.createGraphics();
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

            // rounded-square dark background
            double r = n * 0.18;
            g.setColor(BG);
            g.fill(new RoundRectangle2D.Double(0, 0, n, n, r, r));

            double k = n / 32.0;
            // emerald outer hexagon (with slight padding)
            g.setColor(EMERALD);
            g.fill(polygon(OUTER, k, n * 0.02));
            // dark inner hexagon → ring
            g.setColor(BG);
            g.fill(polygon(INNER, k, 0));
            // emerald mountain peak
            g.setColor(EMERALD);
            g.fill(polygon(PEAK, k, 0));

            g.dispose();
            File out = new File(root, "res/mipmap-" + dirs[i] + "/ic_launcher.png");
            out.getParentFile().mkdirs();
            ImageIO.write(img, "png", out);
            System.out.println("wrote " + out.getPath() + " (" + n + "x" + n + ")");
        }
    }

    static java.awt.Polygon polygon(double[][] pts, double k, double pad) {
        java.awt.Polygon p = new java.awt.Polygon();
        for (double[] pt : pts) p.addPoint((int) Math.round(pt[0] * k + pad), (int) Math.round(pt[1] * k + pad));
        return p;
    }
}
